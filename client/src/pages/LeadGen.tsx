import { useState, useRef } from "react";
import {
  fitMultiplier, maxPillar, reband, sortByComposite,
  type Severity, type Pillars, type PillarKey, type LeadStatus,
} from "../lib/triptique";

type Lead = {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  placeId: string;
  url: string;
  types: string[];
};

type ScoredLead = Lead & {
  website: string;
  domain: string;
  status: LeadStatus;      // scored / unreadable / no-website / pending / error
  pillars: Pillars;
  severity: { found: Severity; secure: Severity; compliant: Severity };
  exposure: number;        // 0–100 composite of the three pillars (from server)
  composite: number;       // exposure × fit, computed client-side for ranking
  verdict: "Hot" | "Warm" | "Cold"; // assigned by the relative banding pass
  cms: string;
  cveRisk: boolean;
  signals: string[];
  emailHook: string;
  fetchNote: string;
  wappalyzerUrl?: string;
  sucuriUrl?: string;
  scoring?: "pending" | "done" | "error";
  scoreError?: string;
};

const VERDICT_COLORS = {
  Hot: { bg: "#0d2010", border: "#2a5a1a", text: "#97c459", badge: "#1a4020" },
  Warm: { bg: "#1a1200", border: "#4a3800", text: "#f0a500", badge: "#3a2800" },
  Cold: { bg: "#0c141b", border: "#1c2c39", text: "#8fa3b5", badge: "#1c2c39" },
};

const PILLAR_LABELS: Record<PillarKey, string> = {
  found: "Found", secure: "Secure", compliant: "Compliant",
};

const mono: React.CSSProperties = { fontFamily: "JetBrains Mono, monospace" };

function pillarColor(s: Severity): { bg: string; text: string } {
  if (s === "critical") return { bg: "#2a0808", text: "#ff6b6b" };
  if (s === "moderate") return { bg: "#3a2800", text: "#f0a500" };
  return { bg: "#0d2010", text: "#6a8050" };
}

// What to show in the verdict column / CSV: unreadable + no-website firms are
// not scored, so they must never be shown as a (misleading) "Cold".
function displayVerdict(l: ScoredLead): string {
  if (l.status === "unreadable") return "Unreadable";
  if (l.status === "no-website") return "No site";
  return l.verdict;
}

export default function LeadGen() {
  const [niche, setNiche] = useState("solicitors");
  const [location, setLocation] = useState("Edinburgh");
  const [leads, setLeads] = useState<ScoredLead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [scoredCount, setScoredCount] = useState(0);
  const [expandedHook, setExpandedHook] = useState<string | null>(null);
  const [copiedHook, setCopiedHook] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#0c141b", color: "#d8e2ea",
    border: "1px solid #233344", borderRadius: 10, padding: "12px 14px",
    boxSizing: "border-box", fontSize: 14, ...mono, outline: "none",
  };

  // ── Step 1: Search ─────────────────────────────────────────────────────────
  async function fetchLeads() {
    setLoading(true);
    setError(null);
    setSearched(true);
    setLeads([]);
    setScoredCount(0);

    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, location }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "Failed to fetch leads");
      } else {
        const raw: ScoredLead[] = (data.leads ?? []).map((l: Lead) => ({
          ...l, website: "", domain: "", status: "pending" as const,
          pillars: { found: 0, secure: 0, compliant: 0 },
          severity: { found: "ok" as const, secure: "ok" as const, compliant: "ok" as const },
          exposure: 0, composite: 0, verdict: "Cold" as const,
          cms: "Unknown", cveRisk: false, signals: [], emailHook: "",
          fetchNote: "", scoring: "pending" as const,
        }));
        setLeads(raw);
        // Auto-score immediately
        scoreAll(raw);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Score all leads sequentially ───────────────────────────────────
  async function scoreAll(rawLeads: ScoredLead[]) {
    setScoring(true);
    setScoredCount(0);

    const abort = new AbortController();
    abortRef.current = abort;

    const updated = [...rawLeads];

    for (let i = 0; i < updated.length; i++) {
      if (abort.signal.aborted) break;

      try {
        const resp = await fetch("/api/score-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            placeId: updated[i].placeId,
            name: updated[i].name,
            location,
          }),
          signal: abort.signal,
        });

        const data = await resp.json();
        if (resp.ok) {
          const exposure = data.exposure ?? 0;
          const composite = exposure * fitMultiplier(updated[i].reviewCount ?? 0);
          const status: LeadStatus = data.status ?? "scored";
          updated[i] = { ...updated[i], ...data, status, exposure, composite, scoring: "done" };
        } else {
          updated[i] = { ...updated[i], scoring: "error", status: "error", scoreError: data.error };
        }
      } catch (e) {
        if (abort.signal.aborted) break;
        updated[i] = { ...updated[i], scoring: "error", status: "error", scoreError: "Scoring failed" };
      }

      setScoredCount(i + 1);
      // Reband live so the batch stays relatively classified as it streams in.
      setLeads(reband(sortByComposite(updated)));

      // Small delay to avoid rate limits
      if (i < updated.length - 1) await sleep(500);
    }

    // Final authoritative banding pass over the complete batch.
    setLeads(reband(sortByComposite(updated)));
    setScoring(false);
  }

  function stopScoring() {
    abortRef.current?.abort();
    setScoring(false);
  }

  function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

  function copyHook(hook: string, id: string) {
    navigator.clipboard.writeText(hook).then(() => {
      setCopiedHook(id);
      setTimeout(() => setCopiedHook(null), 2000);
    });
  }

  function exportCSV() {
    const headers = ["Name", "Domain", "Verdict", "Exposure", "Found", "Secure", "Compliant", "CMS", "CVE Risk", "Signals", "Email Hook", "Address", "Rating", "Reviews", "Wappalyzer", "Sucuri"];
    const rows = leads
      .filter(l => l.scoring === "done")
      .sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0))
      .map(l => [
        l.name, l.domain, displayVerdict(l), l.exposure,
        l.pillars.found, l.pillars.secure, l.pillars.compliant,
        l.cms, l.cveRisk ? "YES" : "no",
        l.signals.join("; "),
        l.emailHook,
        l.address, l.rating ?? "", l.reviewCount,
        l.wappalyzerUrl ?? "", l.sucuriUrl ?? "",
      ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `leads-${niche}-${location}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const hot = leads.filter(l => l.verdict === "Hot" && l.scoring === "done").length;
  const warm = leads.filter(l => l.verdict === "Warm" && l.scoring === "done").length;
  const done = leads.filter(l => l.scoring === "done").length;

  return (
    <div style={{ minHeight: "100vh", background: "#081015", color: "#d8e2ea", fontFamily: "Lexend, sans-serif" }}>
      <style>{`
        input:focus { border-color: #97c459 !important; }
        .lead-row:hover { border-color: #2a5a1a !important; }
        .btn-copy:hover { background: #1a4020 !important; }
        .btn-wap:hover { opacity: 0.8; }
        ::-webkit-scrollbar { width: 6px; } 
        ::-webkit-scrollbar-track { background: #0c141b; }
        ::-webkit-scrollbar-thumb { background: #233344; border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "48px 32px 72px" }}>

        {/* Header */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#101922", border: "1px solid #1c2c39", borderRadius: 999, padding: "8px 14px", marginBottom: 22 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: scoring ? "#f0a500" : "#00e676", display: "inline-block" }} />
          <span style={{ fontSize: 12, ...mono, color: "#8fa3b5" }}>
            {scoring ? `Scoring ${scoredCount}/${leads.length}…` : "Lead Finder + Tech Scorer · Live Data"}
          </span>
        </div>

        <h1 style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: "clamp(40px, 7vw, 82px)", lineHeight: 0.92, letterSpacing: "0.04em", marginBottom: 14 }}>
          Find <span style={{ color: "#97c459" }}>& score</span> local<br />business leads
        </h1>
        <p style={{ maxWidth: 680, fontSize: 16, lineHeight: 1.7, color: "#8fa3b5", marginBottom: 28 }}>
          Searches Google Places then automatically scans each website for WordPress, Elementor, CVE risk, and AI visibility gaps — ranked hottest first.
        </p>

        {/* Search form */}
        <div style={{ background: "#101922", border: "1px solid #1c2c39", borderRadius: 18, padding: 22, marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 14, alignItems: "flex-end" }}>
            <div>
              <label style={{ display: "block", ...mono, fontSize: 11, color: "#8fa3b5", marginBottom: 6 }}>Business type / niche</label>
              <input value={niche} onChange={e => setNiche(e.target.value)} placeholder="e.g. solicitors, estate agents" style={inputStyle}
                onKeyDown={e => e.key === "Enter" && !loading && fetchLeads()} />
            </div>
            <div>
              <label style={{ display: "block", ...mono, fontSize: 11, color: "#8fa3b5", marginBottom: 6 }}>Location</label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g. Edinburgh, Glasgow" style={inputStyle}
                onKeyDown={e => e.key === "Enter" && !loading && fetchLeads()} />
            </div>
            <button
              onClick={fetchLeads}
              disabled={loading || scoring || !niche.trim() || !location.trim()}
              style={{
                padding: "12px 24px", border: "none", borderRadius: 12,
                background: loading ? "#4a6a3a" : "#97c459", color: "#081015",
                fontWeight: 800, cursor: loading ? "not-allowed" : "pointer",
                fontSize: 15, fontFamily: "Lexend, sans-serif", whiteSpace: "nowrap",
              }}
            >
              {loading ? "Searching…" : "Search →"}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#1a0808", border: "1px solid #4a1a1a", borderRadius: 12, padding: 16, color: "#ff6b6b", ...mono, fontSize: 12, marginBottom: 16 }}>
            ✗ {error}
          </div>
        )}

        {/* Progress + summary */}
        {leads.length > 0 && (
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, flex: 1, flexWrap: "wrap" }}>
              {[
                { label: "Found", val: leads.length, color: "#8fa3b5" },
                { label: "🔥 Hot", val: hot, color: "#97c459" },
                { label: "Warm", val: warm, color: "#f0a500" },
                { label: "Scored", val: `${done}/${leads.length}`, color: "#8fa3b5" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ background: "#101922", border: "1px solid #1c2c39", borderRadius: 10, padding: "8px 16px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
                  <div style={{ fontSize: 10, color: "#4a6070", ...mono }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {scoring && (
                <button onClick={stopScoring} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #4a3800", background: "#1a1200", color: "#f0a500", cursor: "pointer", fontSize: 12, ...mono }}>
                  Stop scoring
                </button>
              )}
              {done > 0 && (
                <button onClick={exportCSV} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #233344", background: "#101922", color: "#8fa3b5", cursor: "pointer", fontSize: 12, ...mono }}>
                  ⬇ Export CSV
                </button>
              )}
            </div>
          </div>
        )}

        {/* Scoring progress bar */}
        {scoring && (
          <div style={{ background: "#101922", border: "1px solid #1c2c39", borderRadius: 8, height: 6, marginBottom: 16, overflow: "hidden" }}>
            <div style={{ height: "100%", background: "linear-gradient(90deg, #97c459, #f0a500)", width: `${(scoredCount / leads.length) * 100}%`, transition: "width 0.4s ease", borderRadius: 8 }} />
          </div>
        )}

        {/* Results */}
        {!loading && leads.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 80px 120px 140px 1fr", gap: 12, padding: "4px 16px", ...mono, fontSize: 10, color: "#2a4050" }}>
              <span>SCORE</span>
              <span>BUSINESS & SITE</span>
              <span>CMS</span>
              <span>VERDICT</span>
              <span>SIGNALS</span>
              <span>EMAIL HOOK</span>
            </div>

            {leads.map((lead, i) => {
              const scored = lead.status === "scored";
              const vc = VERDICT_COLORS[lead.verdict] ?? VERDICT_COLORS.Cold;
              const isPending = lead.scoring === "pending";
              const isScoring = isPending && scoring && i === scoredCount;
              const hookId = `hook-${lead.placeId}`;

              return (
                <div
                  key={`${lead.placeId}-${i}`}
                  className="lead-row"
                  style={{
                    background: lead.scoring === "done" ? vc.bg : "#0c141b",
                    border: `1px solid ${lead.scoring === "done" ? vc.border : "#1c2c39"}`,
                    borderRadius: 14, padding: "14px 16px", transition: "border-color 0.15s",
                    opacity: isPending && !isScoring ? 0.5 : 1,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 80px 120px 140px 1fr", gap: 12, alignItems: "start" }}>

                    {/* Score */}
                    <div>
                      {lead.scoring === "done" && scored ? (
                        <>
                          <div style={{ fontSize: 26, fontWeight: 700, color: vc.text, lineHeight: 1 }}>{lead.exposure}</div>
                          <div style={{ fontSize: 10, color: "#4a6070", ...mono }}>/100</div>
                        </>
                      ) : isScoring ? (
                        <div style={{ fontSize: 11, color: "#f0a500", ...mono }}>⟳</div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#2a4050", ...mono }}>—</div>
                      )}
                    </div>

                    {/* Business */}
                    <div>
                      <a href={lead.url} target="_blank" rel="noreferrer"
                        style={{ fontWeight: 700, color: "#d8e2ea", textDecoration: "none", fontSize: 14, display: "block", marginBottom: 2 }}
                        onMouseEnter={e => (e.currentTarget.style.color = "#97c459")}
                        onMouseLeave={e => (e.currentTarget.style.color = "#d8e2ea")}
                      >
                        {lead.name} <span style={{ fontSize: 10, color: "#2a4050" }}>↗</span>
                      </a>
                      {lead.domain ? (
                        <a href={lead.website} target="_blank" rel="noreferrer"
                          style={{ ...mono, fontSize: 11, color: "#4a7090", textDecoration: "none" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#97c459")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#4a7090")}
                        >
                          {lead.domain}
                        </a>
                      ) : (
                        <div style={{ ...mono, fontSize: 11, color: "#2a4050" }}>{lead.address.split(",")[0]}</div>
                      )}
                      {lead.rating != null && (
                        <div style={{ fontSize: 11, color: "#4a6070", marginTop: 4 }}>
                          ★ {lead.rating} · {lead.reviewCount.toLocaleString()} reviews
                        </div>
                      )}
                    </div>

                    {/* CMS */}
                    <div>
                      {lead.scoring === "done" && lead.cms !== "Unknown" ? (
                        <span style={{ ...mono, fontSize: 11, background: vc.badge, color: vc.text, padding: "3px 8px", borderRadius: 6 }}>
                          {lead.cms}
                        </span>
                      ) : (
                        <span style={{ ...mono, fontSize: 11, color: "#2a4050" }}>
                          {lead.scoring === "done" ? "Custom" : "—"}
                        </span>
                      )}
                      {lead.cveRisk && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ ...mono, fontSize: 10, background: "#2a0808", color: "#ff6b6b", padding: "2px 6px", borderRadius: 4 }}>CVE risk</span>
                        </div>
                      )}
                    </div>

                    {/* Verdict */}
                    <div>
                      {lead.scoring === "done" && scored ? (
                        <span style={{ fontWeight: 700, color: vc.text, fontSize: 13 }}>
                          {lead.verdict === "Hot" ? "🔥 " : lead.verdict === "Warm" ? "● " : "○ "}
                          {lead.verdict}
                        </span>
                      ) : lead.scoring === "done" ? (
                        <span style={{ ...mono, fontSize: 11, color: "#5a6b78" }}>{displayVerdict(lead)}</span>
                      ) : isScoring ? (
                        <span style={{ ...mono, fontSize: 11, color: "#f0a500" }}>Scanning…</span>
                      ) : (
                        <span style={{ ...mono, fontSize: 11, color: "#2a4050" }}>Queued</span>
                      )}
                    </div>

                    {/* Signals */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {lead.scoring === "done" && scored && (
                        <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                          {(["found", "secure", "compliant"] as PillarKey[]).map(p => {
                            const pc = pillarColor(lead.severity[p]);
                            return (
                              <span key={p} title={`${PILLAR_LABELS[p]} exposure: ${lead.pillars[p]}/100 (${lead.severity[p]})`}
                                style={{ ...mono, fontSize: 9, padding: "2px 6px", borderRadius: 4, background: pc.bg, color: pc.text }}>
                                {PILLAR_LABELS[p][0]}{lead.pillars[p]}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {lead.scoring === "done" && lead.signals.slice(0, 4).map(s => (
                        <span key={s} style={{ ...mono, fontSize: 10, color: "#8fa3b5", lineHeight: 1.4 }}>· {s}</span>
                      ))}
                      {lead.scoring === "done" && lead.wappalyzerUrl && (
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <a href={lead.wappalyzerUrl} target="_blank" rel="noreferrer"
                            className="btn-wap"
                            style={{ ...mono, fontSize: 10, color: "#4a7090", textDecoration: "none", background: "#0c141b", border: "1px solid #1c2c39", padding: "2px 7px", borderRadius: 5 }}>
                            Wappalyzer ↗
                          </a>
                          <a href={lead.sucuriUrl} target="_blank" rel="noreferrer"
                            className="btn-wap"
                            style={{ ...mono, fontSize: 10, color: "#4a7090", textDecoration: "none", background: "#0c141b", border: "1px solid #1c2c39", padding: "2px 7px", borderRadius: 5 }}>
                            Sucuri ↗
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Email Hook */}
                    <div>
                      {lead.scoring === "done" && lead.emailHook ? (
                        <>
                          <div
                            style={{ fontSize: 12, color: "#8fa3b5", fontStyle: "italic", lineHeight: 1.5, cursor: "pointer", display: expandedHook === hookId ? "block" : "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                            onClick={() => setExpandedHook(expandedHook === hookId ? null : hookId)}
                          >
                            {lead.emailHook}
                          </div>
                          <button
                            className="btn-copy"
                            onClick={() => copyHook(lead.emailHook, hookId)}
                            style={{ marginTop: 6, ...mono, fontSize: 10, padding: "3px 10px", borderRadius: 6, border: "1px solid #1c2c39", background: "#101922", color: copiedHook === hookId ? "#97c459" : "#4a6070", cursor: "pointer", transition: "all 0.15s" }}
                          >
                            {copiedHook === hookId ? "Copied ✓" : "Copy hook"}
                          </button>
                        </>
                      ) : lead.scoring === "done" ? (
                        <span style={{ ...mono, fontSize: 11, color: "#2a4050" }}>No hook — use AI visibility angle</span>
                      ) : null}
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && !searched && (
          <div style={{ background: "#101922", border: "1px dashed #1c2c39", borderRadius: 14, padding: 40, color: "#2a4050", ...mono, fontSize: 13, textAlign: "center" }}>
            Enter a business type and location above to find and score leads automatically.
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <a href="/" style={{ color: "#97c459", textDecoration: "none", padding: "10px 18px", borderRadius: 999, border: "1px solid #1c2c39", fontWeight: 700, fontSize: 13 }}>
            ← Back to Geo Heatmap
          </a>
        </div>

      </div>
    </div>
  );
}

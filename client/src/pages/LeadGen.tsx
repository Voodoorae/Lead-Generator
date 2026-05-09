import { useState } from "react";

type Lead = {
  name: string;
  address: string;
  rating: number | null;
  reviewCount: number;
  placeId: string;
  url: string;
  types: string[];
};

export default function LeadGen() {
  const [niche, setNiche] = useState("roofing contractors");
  const [location, setLocation] = useState("Edinburgh");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function fetchLeads() {
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const resp = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche, location }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error ?? "Failed to fetch leads");
        setLeads([]);
      } else {
        setLeads(data.leads ?? []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
      setLeads([]);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#0c141b", color: "#d8e2ea",
    border: "1px solid #233344", borderRadius: 10, padding: "12px 14px",
    boxSizing: "border-box", fontSize: 14, fontFamily: "JetBrains Mono, monospace",
    outline: "none",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#081015", color: "#d8e2ea", fontFamily: "Lexend, sans-serif" }}>
      <style>{`input:focus { border-color: #97c459 !important; }`}</style>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "54px 32px 72px" }}>

        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#101922", border: "1px solid #1c2c39", borderRadius: 999, padding: "8px 14px", marginBottom: 22 }}>
          <span style={{ width: 10, height: 10, borderRadius: 999, background: "#00e676", display: "inline-block" }} />
          <span style={{ fontSize: 12, fontFamily: "JetBrains Mono, monospace", color: "#8fa3b5" }}>Niche Lead Finder · Live Data</span>
        </div>

        <h1 style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: "clamp(46px, 8vw, 92px)", lineHeight: 0.92, letterSpacing: "0.04em", marginBottom: 18 }}>
          Find <span style={{ color: "#97c459" }}>real businesses</span><br />in your niche
        </h1>
        <p style={{ maxWidth: 720, fontSize: 18, lineHeight: 1.7, color: "#8fa3b5", marginBottom: 34 }}>
          Pulls live business listings from Google Places based on your niche and location. Each result links directly to their Google Maps profile.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 18, marginBottom: 24 }}>
          <div style={{ background: "#101922", border: "1px solid #1c2c39", borderRadius: 18, padding: 22 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ display: "block", fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#8fa3b5", marginBottom: 6 }}>Niche</label>
                <input value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. plumbers, dentists" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#8fa3b5", marginBottom: 6 }}>Location</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Edinburgh, London" style={inputStyle} />
              </div>
            </div>
            <button
              onClick={fetchLeads}
              disabled={loading || !niche.trim() || !location.trim()}
              style={{
                width: "100%", padding: "14px 16px", border: "none", borderRadius: 12,
                background: loading ? "#4a6a3a" : "#97c459",
                color: "#081015", fontWeight: 800, cursor: loading ? "not-allowed" : "pointer",
                fontSize: 15, fontFamily: "Lexend, sans-serif", transition: "background 0.15s",
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "#7ab040"; }}
              onMouseLeave={(e) => { if (!loading) e.currentTarget.style.background = "#97c459"; }}
            >
              {loading ? "Searching…" : `Find ${niche} in ${location} →`}
            </button>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
            {[
              ["Live data", "Pulls real businesses from Google Places in real time"],
              ["Niche + location", `Searches for "${niche}" in ${location}`],
              ["Click to explore", "Each result opens directly in Google Maps"],
            ].map(([title, body]) => (
              <div key={title} style={{ background: "#101922", border: "1px solid #1c2c39", borderRadius: 18, padding: 18 }}>
                <div style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 24, color: "#97c459", marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, color: "#8fa3b5" }}>{body}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "#101922", border: "1px solid #1c2c39", borderRadius: 18, padding: 22 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <strong style={{ fontSize: 16 }}>
              {searched && !loading
                ? leads.length > 0
                  ? `${leads.length} businesses found in ${location}`
                  : error ? "Error fetching leads" : "No results found"
                : "Lead results"}
            </strong>
            <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#8fa3b5" }}>Google Places · live</span>
          </div>

          {!searched && !loading && (
            <div style={{ background: "#0c141b", border: "1px dashed #233344", borderRadius: 12, padding: 28, color: "#4a6070", fontFamily: "JetBrains Mono, monospace", fontSize: 13, textAlign: "center" }}>
              Enter a niche and location above, then click the button to find real businesses.
            </div>
          )}

          {loading && (
            <div style={{ background: "#0c141b", border: "1px solid #233344", borderRadius: 12, padding: 28, color: "#97c459", fontFamily: "JetBrains Mono, monospace", fontSize: 13, textAlign: "center" }}>
              Searching Google Places for <em>{niche}</em> in <em>{location}</em>…
            </div>
          )}

          {error && !loading && (
            <div style={{ background: "#1a0808", border: "1px solid #4a1a1a", borderRadius: 12, padding: 16, color: "#ff6b6b", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
              ✗ {error}
            </div>
          )}

          {!loading && !error && leads.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 0.5fr 0.6fr", gap: 12, padding: "6px 14px", fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#2a4050" }}>
                <span>BUSINESS</span>
                <span>ADDRESS</span>
                <span>RATING</span>
                <span>REVIEWS</span>
              </div>
              {leads.map((lead, i) => (
                <div
                  key={`${lead.placeId}-${i}`}
                  style={{ display: "grid", gridTemplateColumns: "2fr 1.4fr 0.5fr 0.6fr", gap: 12, alignItems: "center", background: "#0c141b", border: "1px solid #1c2c39", borderRadius: 12, padding: "13px 14px", transition: "border-color 0.15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#97c459")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#1c2c39")}
                >
                  <a
                    href={lead.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontWeight: 700, color: "#d8e2ea", textDecoration: "none", display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = "#97c459")}
                    onMouseLeave={(e) => (e.currentTarget.style.color = "#d8e2ea")}
                  >
                    {lead.name}
                    <span style={{ fontSize: 10, color: "#2a4050" }}>↗</span>
                  </a>
                  <div style={{ color: "#8fa3b5", fontFamily: "JetBrains Mono, monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {lead.address}
                  </div>
                  <div style={{ color: lead.rating && lead.rating >= 4 ? "#97c459" : "#f0a500", fontFamily: "JetBrains Mono, monospace", fontSize: 13, fontWeight: 700 }}>
                    {lead.rating != null ? `★ ${lead.rating}` : "—"}
                  </div>
                  <div style={{ color: "#8fa3b5", fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}>
                    {lead.reviewCount > 0 ? lead.reviewCount.toLocaleString() : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !error && searched && leads.length === 0 && (
            <div style={{ background: "#0c141b", border: "1px solid #1c2c39", borderRadius: 12, padding: 20, color: "#4a6070", fontFamily: "JetBrains Mono, monospace", fontSize: 13, textAlign: "center" }}>
              No businesses found for "{niche}" in "{location}". Try a different niche or broader location.
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <a href="/" style={{ color: "#97c459", textDecoration: "none", padding: "12px 20px", borderRadius: 999, border: "1px solid #1c2c39", fontWeight: 700, fontSize: 13 }}>
            ← Back to Geo Heatmap
          </a>
        </div>

      </div>
    </div>
  );
}

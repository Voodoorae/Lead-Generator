import { useMemo, useState } from "react";

type Scenario = "before" | "after" | "mixed";
type Competition = "low" | "medium" | "high";

function rankStyle(rank: number) {
  if (rank === 1) return { bg: "#3b6d11", color: "#c0dd97" };
  if (rank === 2) return { bg: "#639922", color: "#eaf3de" };
  if (rank === 3) return { bg: "#97c459", color: "#27500a" };
  if (rank <= 6) return { bg: "#fac775", color: "#633806" };
  if (rank <= 10) return { bg: "#f0997b", color: "#4a1b0c" };
  return { bg: "#e24b4a", color: "#fcebeb" };
}

function rankLabel(rank: number) {
  if (rank === 1) return "Rank 1";
  if (rank === 2) return "Rank 2";
  if (rank === 3) return "Rank 3";
  if (rank <= 6) return "Rank 4–6";
  if (rank <= 10) return "Rank 7–10";
  return "Rank 11+";
}

function seededRand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function generateGrid(size: number, scenario: Scenario, comp: Competition) {
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  const rand = seededRand(scenario.charCodeAt(0) * 31 + comp.charCodeAt(0) * 7 + size);
  const ranks: number[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const dist = Math.sqrt((row - cy) ** 2 + (col - cx) ** 2) / (size / 2);
      let base: number;
      if (scenario === "after") {
        base = dist * (comp === "high" ? 4 : comp === "medium" ? 3 : 2) + rand() * 1.5;
        base = Math.max(1, Math.min(20, Math.round(base + 0.5)));
      } else if (scenario === "before") {
        base = dist * (comp === "high" ? 8 : comp === "medium" ? 7 : 5) + rand() * 5 + 3;
        base = Math.max(3, Math.min(25, Math.round(base)));
      } else {
        base = dist * (comp === "high" ? 6 : comp === "medium" ? 5 : 3.5) + rand() * 4;
        base = Math.max(1, Math.min(22, Math.round(base + 1)));
      }
      ranks.push(base);
    }
  }
  return ranks;
}

function Dot({ rank, row, col, animIdx }: { rank: number; row: number; col: number; animIdx: number }) {
  const [hovered, setHovered] = useState(false);
  const { bg, color } = rankStyle(rank);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: bg,
        color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        fontWeight: 500,
        cursor: "default",
        position: "relative",
        zIndex: hovered ? 10 : 1,
        transform: hovered ? "scale(1.3)" : "scale(1)",
        transition: "transform 0.12s ease",
        animation: `popIn 0.25s ease-out ${animIdx * 8}ms both`,
      }}
    >
      {rank}
      {hovered && (
        <div style={{
          position: "absolute", bottom: 36, left: "50%", transform: "translateX(-50%)",
          background: "#1d2535", border: "1px solid #2a3347", borderRadius: 6,
          padding: "5px 10px", fontSize: 11, whiteSpace: "nowrap", color: "#d8e2ea",
          pointerEvents: "none", boxShadow: "0 4px 12px rgba(0,0,0,0.5)", zIndex: 100,
        }}>
          Row {row + 1}, Col {col + 1} · {rankLabel(rank)}
        </div>
      )}
    </div>
  );
}

export default function GeoHeatmap() {
  const [biz, setBiz] = useState("Fort Lauderdale Carpet Co.");
  const [kw, setKw] = useState("carpet cleaning fort lauderdale");
  const [gridSize, setGridSize] = useState(11);
  const [scenario, setScenario] = useState<Scenario>("after");
  const [comp, setComp] = useState<Competition>("medium");
  const [ranks, setRanks] = useState<number[] | null>(null);
  const [scanLabel, setScanLabel] = useState("");
  const [scanDate, setScanDate] = useState("");

  function runScan() {
    const generated = generateGrid(gridSize, scenario, comp);
    setRanks(generated);
    setScanLabel(kw || "your keyword");
    setScanDate(new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
  }

  const total = ranks?.length ?? 0;
  const avgRank = useMemo(() => (ranks ? (ranks.reduce((a, b) => a + b, 0) / total).toFixed(1) : null), [ranks, total]);
  const top3 = ranks ? ranks.filter((r) => r <= 3).length : null;
  const top10 = ranks ? ranks.filter((r) => r <= 10).length : null;
  const outPack = ranks ? ranks.filter((r) => r > 10).length : null;
  const solv = ranks && top10 != null ? Math.round((top10 / total) * 100) : null;

  function insightText() {
    if (!ranks || avgRank == null || top3 == null || outPack == null || solv == null) return "";
    const name = biz || "Your Business";
    const keyword = kw || "your keyword";
    if (scenario === "after") return `<b>${name}</b> is dominating <em>"${keyword}"</em> with a <b>rank ${avgRank} average</b> across the grid and <b>${top3} top-3 positions</b>. Share of Local Voice sits at <b>${solv}%</b> — this is what a fully optimised GBP + local content architecture looks like.`;
    if (scenario === "before") return `<b>${name}</b> is largely invisible for <em>"${keyword}"</em>. Average rank is <b>${avgRank}</b> with only <b>${top3} top-3 positions</b> out of ${total} grid points. <b>${outPack} points</b> are outside the map pack — those are leads going to competitors every day.`;
    return `<b>${name}</b> has made progress on <em>"${keyword}"</em> — strong in the centre but weak at the edges. Average rank <b>${avgRank}</b>, top-3 coverage at <b>${top3}/${total} points</b>. Neighbourhood expansion and citation clean-up will push the edges into the pack.`;
  }

  const LEGEND = [
    { label: "Rank 1", bg: "#3b6d11" },
    { label: "Rank 2", bg: "#639922" },
    { label: "Rank 3", bg: "#97c459" },
    { label: "Rank 4–6", bg: "#fac775" },
    { label: "Rank 7–10", bg: "#f0997b" },
    { label: "Rank 11+", bg: "#e24b4a" },
  ];

  const kpiColor = (v: number | null, type: "avg" | "top3" | "solv" | "out") => {
    if (v == null) return "#d8e2ea";
    if (type === "avg") return v <= 3 ? "#97c459" : v <= 6 ? "#fac775" : "#e24b4a";
    if (type === "top3") return v >= total * 0.5 ? "#97c459" : v >= total * 0.2 ? "#fac775" : "#e24b4a";
    if (type === "solv") return v >= 70 ? "#97c459" : v >= 40 ? "#fac775" : "#e24b4a";
    if (type === "out") return v <= total * 0.2 ? "#97c459" : v <= total * 0.5 ? "#fac775" : "#e24b4a";
    return "#d8e2ea";
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "#0c141b", color: "#d8e2ea",
    border: "1px solid #233344", borderRadius: 8, padding: "10px 12px",
    fontSize: 13, fontFamily: "JetBrains Mono, monospace", boxSizing: "border-box",
    outline: "none",
  };

  const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer" };

  return (
    <div style={{ minHeight: "100vh", background: "#081015", color: "#d8e2ea", fontFamily: "Lexend, sans-serif" }}>
      <style>{`
        @keyframes popIn { from { opacity:0; transform:scale(0.4); } to { opacity:1; transform:scale(1); } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        input:focus, select:focus { border-color: #97c459 !important; }
      `}</style>

      <header style={{ padding: "14px 28px", borderBottom: "1px solid #1c2c39", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0c141b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, background: "#1a3d12", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>◉</div>
          <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 18, letterSpacing: "0.06em" }}>LOCAL<span style={{ color: "#97c459" }}>GRID</span></span>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "#4a6070", border: "1px solid #1c2c39", padding: "2px 8px", borderRadius: 12 }}>geo-heatmap</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#4a6070" }}>simulate local ranking visibility</span>
          <a href="/lead-gen" style={{ color: "#081015", textDecoration: "none", background: "#97c459", padding: "8px 16px", borderRadius: 999, fontWeight: 800, fontSize: 13, letterSpacing: "0.01em" }}>
            Open Lead Gen Page
          </a>
        </div>
      </header>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "36px 28px 72px" }}>
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: "clamp(32px,5vw,56px)", lineHeight: 1, letterSpacing: "0.02em", marginBottom: 10 }}>
            Map your local<br /><span style={{ color: "#97c459" }}>search visibility</span>
          </h1>
          <p style={{ color: "#4a6070", fontSize: 14, lineHeight: 1.7, maxWidth: 520 }}>
            Simulate how your business ranks across a geographic grid for any keyword — before and after optimisation.
          </p>
        </div>

        <div style={{ background: "#0c141b", border: "1px solid #1c2c39", borderRadius: 12, padding: "20px 24px", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div>
              <label style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#4a6070", display: "block", marginBottom: 6 }}>Business name</label>
              <input style={inputStyle} value={biz} onChange={(e) => setBiz(e.target.value)} placeholder="e.g. Fort Lauderdale Carpet Co." />
            </div>
            <div>
              <label style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#4a6070", display: "block", marginBottom: 6 }}>Target keyword</label>
              <input style={inputStyle} value={kw} onChange={(e) => setKw(e.target.value)} placeholder="e.g. carpet cleaning fort lauderdale" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 18 }}>
            <div>
              <label style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#4a6070", display: "block", marginBottom: 6 }}>Grid size</label>
              <select style={selectStyle} value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))}>
                <option value={7}>7×7 (49 pts)</option>
                <option value={9}>9×9 (81 pts)</option>
                <option value={11}>11×11 (121 pts)</option>
                <option value={13}>13×13 (169 pts)</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#4a6070", display: "block", marginBottom: 6 }}>Current scenario</label>
              <select style={selectStyle} value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
                <option value="before">Before optimisation</option>
                <option value="after">After optimisation</option>
                <option value="mixed">Partial progress</option>
              </select>
            </div>
            <div>
              <label style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#4a6070", display: "block", marginBottom: 6 }}>Market competition</label>
              <select style={selectStyle} value={comp} onChange={(e) => setComp(e.target.value as Competition)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <button
            onClick={runScan}
            style={{ width: "100%", padding: "12px 0", background: "#3b6d11", color: "#c0dd97", border: "none", borderRadius: 8, fontFamily: "Bebas Neue, sans-serif", fontSize: 18, letterSpacing: "0.04em", cursor: "pointer", transition: "background 0.15s" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#27500a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "#3b6d11")}
          >
            Generate geo-heatmap scan →
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 20 }}>
          {LEGEND.map((l) => (
            <div key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4a6070" }}>
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: l.bg, flexShrink: 0 }} />
              {l.label}
            </div>
          ))}
        </div>

        {ranks && (
          <div style={{ animation: "fadeUp 0.3s ease-out both" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
              {[
                { label: "Average rank", val: avgRank, type: "avg" as const, raw: avgRank ? parseFloat(avgRank) : null },
                { label: "Top 3 visibility", val: top3 != null ? `${top3}/${total}` : null, type: "top3" as const, raw: top3 },
                { label: "Share of local voice", val: solv != null ? `${solv}%` : null, type: "solv" as const, raw: solv },
                { label: "Out of map pack", val: outPack, type: "out" as const, raw: outPack },
              ].map((k) => (
                <div key={k.label} style={{ background: "#0c141b", border: "1px solid #1c2c39", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 10, color: "#4a6070", marginBottom: 6 }}>{k.label}</div>
                  <div style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 28, color: kpiColor(k.raw, k.type) }}>{k.val ?? "—"}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#0c141b", border: "1px solid #1c2c39", borderRadius: 12, padding: "16px 20px", marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#4a6070" }}>
                  Keyword: <span style={{ color: "#d8e2ea" }}>{scanLabel}</span>
                </span>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 11, color: "#4a6070" }}>{scanDate}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${gridSize}, 28px)`, gap: 4, justifyContent: "center", overflowX: "auto" }}>
                {ranks.map((r, i) => <Dot key={i} rank={r} row={Math.floor(i / gridSize)} col={i % gridSize} animIdx={i} />)}
              </div>
            </div>

            <div style={{ background: "#0c141b", border: "1px solid #1c2c39", borderRadius: 12, padding: "16px 20px" }}>
              <div style={{ fontSize: 13, color: "#8fa3b5", lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: insightText() }} />
              <div style={{ marginTop: 14, padding: "10px 14px", border: "1px solid #1c2c39", borderRadius: 8, textAlign: "center" }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, color: "#4a6070" }}>
                  Improve these results → run the{" "}
                  <a href="/lead-gen" style={{ color: "#97c459", textDecoration: "none" }}>Lead Gen finder</a>
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

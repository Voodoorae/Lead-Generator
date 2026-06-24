// ── Proxaim Triptique banding ────────────────────────────────────────────────
// Pure, testable classification logic shared by the prospecting UI. Kept free of
// React/DOM so it can move into a shared scoring core with the full Proxaim
// diagnostic later. The server emits raw 0–100 pillar exposure; this module
// turns a whole batch into the relative Hot/Warm/Cold shortlist.

export type Severity = "ok" | "moderate" | "critical";
export type Pillars = { found: number; secure: number; compliant: number };
export type PillarKey = keyof Pillars;
export type Verdict = "Hot" | "Warm" | "Cold";
// Result classification (distinct from the fetch lifecycle): a site we could read
// and score, one we couldn't read, or one with no website at all.
export type LeadStatus = "pending" | "scored" | "unreadable" | "no-website" | "error";

export interface Bandable {
  placeId: string;
  pillars: Pillars;
  composite: number;
  status: LeadStatus;
  verdict: Verdict;
}

// A firm "meaningfully fails" a pillar at moderate severity or worse.
export const FAIL_THRESHOLD = 34;
// Hot is capped at the top ~20% of the readable batch.
export const HOT_FRACTION = 0.2;

// Fit = a light reviewCount-based size/affordability proxy (the only real
// per-lead signal we have). Gentle band so it nudges ranking, never dominates.
export function fitMultiplier(reviewCount: number): number {
  if (reviewCount >= 100) return 1.15;
  if (reviewCount >= 30) return 1.05;
  if (reviewCount >= 5) return 1.0;
  return 0.85;
}

export function maxPillar(p: Pillars): number {
  return Math.max(p.found, p.secure, p.compliant);
}

// Hot/Warm/Cold is RELATIVE to the batch, so it can only be assigned once the
// batch is scored. Hot = top ~20% by composite, but ONLY among readable firms
// that meaningfully fail ≥1 pillar — so a clean firm at the top of a good batch
// is never mislabelled Hot, Hot can be smaller than 20%, and unreadable/no-site
// firms are excluded entirely rather than diluting the shortlist.
export function reband<T extends Bandable>(list: T[]): T[] {
  const scored = list.filter((l) => l.status === "scored");
  const eligible = scored
    .filter((l) => maxPillar(l.pillars) >= FAIL_THRESHOLD)
    .sort((a, b) => b.composite - a.composite);
  const hotCap = Math.min(Math.ceil(scored.length * HOT_FRACTION), eligible.length);
  const hotIds = new Set(eligible.slice(0, hotCap).map((l) => l.placeId));

  return list.map((l) => {
    if (l.status !== "scored") return l;
    const verdict: Verdict = hotIds.has(l.placeId)
      ? "Hot"
      : maxPillar(l.pillars) >= FAIL_THRESHOLD
        ? "Warm"
        : "Cold";
    return { ...l, verdict };
  });
}

// Scored-first, hottest composite first; leaves unscored rows in place.
export function sortByComposite<T extends { composite: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => (b.composite ?? 0) - (a.composite ?? 0));
}

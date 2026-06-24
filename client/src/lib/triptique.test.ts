import test from "node:test";
import assert from "node:assert/strict";
import { reband, fitMultiplier, type Bandable } from "./triptique.js";

function mk(
  id: string,
  p: { f: number; s: number; c: number },
  composite: number,
  status: Bandable["status"] = "scored",
): Bandable {
  return {
    placeId: id,
    pillars: { found: p.f, secure: p.s, compliant: p.c },
    composite,
    status,
    verdict: "Cold",
  };
}

test("Hot is a minority — capped at ~20% of the scored batch", () => {
  const list = Array.from({ length: 10 }, (_, i) => mk(`p${i}`, { f: 80, s: 80, c: 80 }, 90 - i));
  const hot = reband(list).filter((l) => l.verdict === "Hot").length;
  assert.equal(hot, 2); // ceil(10 * 0.2)
});

test("a clean firm at the top of a good batch is never Hot (floor gate)", () => {
  const list = [
    mk("clean", { f: 10, s: 0, c: 0 }, 50), // below the fail threshold
    mk("bad", { f: 80, s: 0, c: 0 }, 40), // meaningfully fails a pillar
  ];
  const out = reband(list);
  assert.equal(out.find((l) => l.placeId === "clean")!.verdict, "Cold");
  assert.equal(out.find((l) => l.placeId === "bad")!.verdict, "Hot");
});

test("unreadable firms are excluded from banding and the Hot denominator", () => {
  const list = [
    ...Array.from({ length: 5 }, (_, i) => mk(`s${i}`, { f: 80, s: 80, c: 80 }, 90 - i)),
    ...Array.from({ length: 5 }, (_, i) => mk(`u${i}`, { f: 0, s: 0, c: 0 }, 0, "unreadable")),
  ];
  const out = reband(list);
  assert.equal(out.filter((l) => l.verdict === "Hot").length, 1); // ceil(5 * 0.2), not 10
  assert.ok(out.filter((l) => l.status === "unreadable").every((l) => l.verdict === "Cold"));
});

test("fit multiplier rewards established firms, gently", () => {
  assert.equal(fitMultiplier(200), 1.15);
  assert.equal(fitMultiplier(0), 0.85);
  assert.ok(fitMultiplier(50) > fitMultiplier(3));
});

test("Warm = exposed but outside the Hot slice; Cold = broadly OK", () => {
  const list = [
    mk("a", { f: 90, s: 90, c: 90 }, 95),
    mk("b", { f: 50, s: 0, c: 0 }, 40),
    mk("c", { f: 20, s: 10, c: 0 }, 15), // all pillars below threshold
  ];
  const out = reband(list);
  assert.equal(out.find((l) => l.placeId === "a")!.verdict, "Hot");
  assert.equal(out.find((l) => l.placeId === "b")!.verdict, "Warm");
  assert.equal(out.find((l) => l.placeId === "c")!.verdict, "Cold");
});

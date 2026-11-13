/** Checks each tutorial arena: its start spot can reach that stage's objects, and nothing else. */
import { findPath, generateWorld, gladeArenaAt, standSpot } from "@catchami/shared";
const w = generateWorld();
const poi = (id: string) => w.pois.find((q) => q.id === id)!;
const reach = (from: string, tx: number, ty: number) => !!findPath(w, poi(from).tx, poi(from).ty, tx, ty, 200000);
const checks: Array<[string, string, number, number]> = [
  ["glade_s1", "goal flag", poi("glade_goal").tx, poi("glade_goal").ty],
  ["glade_s3", "Merchant Mari", poi("glade_stall").tx, poi("glade_stall").ty + 1],
  ["glade_s4", "Chef Coco", poi("glade_chef").tx, poi("glade_chef").ty + 1],
  ["glade_s5", "Nurse Nana", poi("glade_nurse").tx, poi("glade_nurse").ty + 1],
  ["glade_s6", "Smith Sora", poi("glade_smith").tx, poi("glade_smith").ty + 1],
  ["glade_s7", "Coach Kiki", poi("glade_bandit").tx, poi("glade_bandit").ty],
  ["glade_s8", "market stall", poi("glade_market").tx, poi("glade_market").ty + 1],
  ["glade_s9", "portal", poi("glade_exit").tx, poi("glade_exit").ty],
];
for (const n of w.nodes.filter((n) => n.id.startsWith("glade"))) {
  const st = standSpot(w, n.tx, n.ty, poi("glade_s2").tx, poi("glade_s2").ty);
  checks.push(["glade_s2", n.id, st?.[0] ?? -1, st?.[1] ?? -1]);
}
let bad = 0;
for (const [from, what, tx, ty] of checks) {
  const ok = tx >= 0 && reach(from, tx, ty) && gladeArenaAt(tx, ty) === gladeArenaAt(poi(from).tx, poi(from).ty);
  if (!ok) bad++;
  console.log(`${from} → ${what}: ${ok ? "ok" : "UNREACHABLE"}`);
}
// Arenas must be sealed from each other.
const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `glade_s${n}`);
const sealed = ids.every((a, i) => ids.every((b, j) => i === j || !reach(a, poi(b).tx, poi(b).ty)));
console.log(`arenas sealed: ${sealed ? "ok" : "LEAK"}`);
if (bad || !sealed) process.exit(1);

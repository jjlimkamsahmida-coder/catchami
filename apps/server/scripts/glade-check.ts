/** Checks each tutorial arena: its start spot can reach that stage's objects, and nothing else. */
import { findPath, generateWorld, gladeArenaAt, standSpot } from "@catchami/shared";
const w = generateWorld();
const poi = (id: string) => w.pois.find((q) => q.id === id)!;
const reach = (from: string, tx: number, ty: number) => !!findPath(w, poi(from).tx, poi(from).ty, tx, ty, 200000);
const checks: Array<[string, string, number, number]> = [
  ["glade_s1", "goal flag", poi("glade_goal").tx, poi("glade_goal").ty],
  ["glade_s3", "Keeper", poi("glade_stall").tx, poi("glade_stall").ty + 1],
  ["glade_s4", "Training Bandit", poi("glade_bandit").tx, poi("glade_bandit").ty],
  ["glade_s5", "market stall", poi("glade_market").tx, poi("glade_market").ty + 1],
  ["glade_s6", "portal", poi("glade_exit").tx, poi("glade_exit").ty],
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
const sealed = !reach("glade_s1", poi("glade_s2").tx, poi("glade_s2").ty) && !reach("glade_s4", poi("glade_s5").tx, poi("glade_s5").ty);
console.log(`arenas sealed: ${sealed ? "ok" : "LEAK"}`);
if (bad || !sealed) process.exit(1);

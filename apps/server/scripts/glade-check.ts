import { findPath, generateWorld, standSpot } from "@catchami/shared";
const w = generateWorld();
const s = w.pois.find((p) => p.id === "glade_spawn")!;
for (const id of ["glade_stall", "glade_exit"]) { const p = w.pois.find((q) => q.id === id)!; console.log(id, findPath(w, s.tx, s.ty, p.tx, p.ty, 200000) ? "ok" : "UNREACHABLE"); }
for (const n of w.nodes.filter((n) => n.id.startsWith("glade"))) { const st = standSpot(w, n.tx, n.ty, s.tx, s.ty); console.log(n.id, st && findPath(w, s.tx, s.ty, st[0], st[1], 200000) ? "ok" : "UNREACHABLE"); }

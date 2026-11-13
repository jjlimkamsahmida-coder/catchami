import { describe, expect, it, beforeAll } from "vitest";
import {
  BUBBLE, chopMarker, ECONOMY, fishX, generateGenome, gradeRound, makeChamber, makeRound, mineAngle, MINIGAMES, randomSeedHex,
  standSpot, tileCenter, toBattleHp, type ChopRound, type MineRound, type PullRound, type ServerMsg,
} from "@catchami/shared";
import { openDb, type Db } from "../src/db/index.ts";
import { ensureGenesis } from "../src/ledger/treasury.ts";
import { createGuest, newId } from "../src/auth.ts";
import { Game, type GameClient } from "../src/world/game.ts";
import { freshPetState } from "../src/world/types.ts";

describe("minigame rules (shared)", () => {
  const seed = randomSeedHex();
  it("grades woodcutting at the marker position", () => {
    const p = makeRound(seed, "r1", "wood") as ChopRound;
    // Find a time where the marker sits exactly on the zone centre.
    let best = 0, bd = 1;
    for (let ms = 0; ms < p.periodMs; ms++) { const d = Math.abs(chopMarker(p, ms) - p.center); if (d < bd) { bd = d; best = ms; } }
    expect(gradeRound(p, best).grade).toBe("perfect");
    // And a time far from it misses.
    let far = 0, fd = 0;
    for (let ms = 0; ms < p.periodMs; ms++) { const d = Math.abs(chopMarker(p, ms) - p.center); if (d > fd) { fd = d; far = ms; } }
    expect(gradeRound(p, far).grade).toBe("miss");
  });
  it("mining uses a circular marker; fish oscillates within bounds", () => {
    const m = makeRound(seed, "r2", "minerals") as MineRound;
    const msAtZone = (((m.zoneDeg - m.startDeg + 360) % 360) / m.degPerSec) * 1000;
    expect(Math.abs(mineAngle(m, msAtZone) - m.zoneDeg)).toBeLessThan(0.01);
    expect(gradeRound(m, msAtZone).grade).toBe("perfect");
    const f = makeRound(seed, "r3", "fish");
    for (let ms = 0; ms < 6000; ms += 37) expect(Math.abs(fishX(f as never, ms))).toBeLessThanOrEqual(1);
  });
  it("herb pull: early and late releases are worse than the sweet spot", () => {
    const p = makeRound(seed, "r4", "herbs") as PullRound;
    expect(gradeRound(p, p.looseMs).grade).toBe("perfect");
    expect(gradeRound(p, p.looseMs * 0.4)).toMatchObject({ grade: "miss", detail: "too early" });
    expect(gradeRound(p, p.looseMs * 1.6)).toMatchObject({ grade: "miss", detail: "too late" });
  });
  it("chambers always hold 2 splashes in 6 slots and are deterministic", () => {
    for (let i = 0; i < 50; i++) {
      const c = makeChamber(seed, "m", i);
      expect(c.length).toBe(6);
      expect(c.filter(Boolean).length).toBe(2);
      expect(makeChamber(seed, "m", i)).toEqual(c);
    }
  });
});

let db: Db, game: Game;
let t = Date.UTC(2026, 10, 12, 12, 0, 0);
const advance = (ms: number) => { const end = t + ms; while (t < end) { t += 100; game.step(); } };

function client(userId: string): GameClient & { inbox: ServerMsg[] } {
  const inbox: ServerMsg[] = [];
  return { userId, displayName: "x", controlled: null, lastMeta: 0, send: (m: ServerMsg) => { inbox.push(m); }, inbox };
}

async function spawn(userId: string, tx: number, ty: number) {
  const id = newId("pet");
  const g = generateGenome(randomSeedHex(), id, "cat", "common");
  await db.query(`INSERT INTO accounts (id, kind, pet_id, user_id) VALUES ($1,'pet',$2,$3)`, [`pet:${id}`, id, userId]);
  await db.query(`INSERT INTO pets (id, owner_id, species, rarity, name, genome, state) VALUES ($1,$2,'cat','common',$3,$4,$5)`, [id, userId, g.name, JSON.stringify(g), JSON.stringify(freshPetState(tileCenter(tx), tileCenter(ty), g.stats))]);
  const p = (await game.reloadPet(id))!;
  p.s.strategy.auto = false;
  p.s.strategy.battle = "balanced";
  return p;
}

beforeAll(async () => {
  db = await openDb();
  await ensureGenesis(db);
  game = new Game(db);
  game.now = () => t;
  await game.load();
}, 60_000);

describe("gathering minigame (server-authoritative)", () => {
  it("opens a round at the spot, grades server-side, caps yield, rejects replays and impossible timing", async () => {
    const u = await createGuest(db);
    const node = game.world.nodes.find((n) => n.resource === "wood")!;
    const spot = standSpot(game.world, node.tx, node.ty, node.tx, node.ty + 1)!;
    const p = await spawn(u.userId, spot[0], spot[1]);
    const c = client(u.userId);
    game.join(c);
    await game.handle(c, { t: "gather", petId: p.id, nodeId: node.id });
    advance(500);
    const round = c.inbox.find((m) => m.t === "mg_round");
    expect(round?.t).toBe("mg_round");
    if (round?.t !== "mg_round") return;
    const params = round.round.params as ChopRound;
    // Too-fast tap is rejected.
    t += 50;
    expect(() => game.minigameInput(u.userId, round.round.id, 20)).toThrow();
    // Next round: perfect timing per the shared motion function.
    advance(1200);
    const r2 = [...c.inbox].reverse().find((m) => m.t === "mg_round");
    if (r2?.t !== "mg_round") throw new Error("no second round");
    const p2 = r2.round.params as ChopRound;
    let best = 400, bd = 1;
    for (let ms = 300; ms < 300 + p2.periodMs; ms++) { const d = Math.abs(chopMarker(p2, ms) - p2.center); if (d < bd) { bd = d; best = ms; } }
    t += best + 20;
    const before = p.s.inventory.wood, energy = p.s.energy, remaining = game.nodes.get(node.id)!.remaining;
    game.minigameInput(u.userId, r2.round.id, best);
    const res = [...c.inbox].reverse().find((m) => m.t === "mg_result");
    expect(res).toMatchObject({ grade: "perfect", gained: MINIGAMES.yield.perfect });
    expect(p.s.inventory.wood).toBe(before + MINIGAMES.yield.perfect);
    expect(p.s.energy).toBeCloseTo(energy - MINIGAMES.energyPerAttempt - ECONOMY.stats.gatherEnergyPerUnit * MINIGAMES.yield.perfect, 5);
    expect(game.nodes.get(node.id)!.remaining).toBe(remaining - MINIGAMES.yield.perfect);
    // Replay of the same round id does nothing.
    expect(() => game.minigameInput(u.userId, r2.round.id, best)).toThrow();
    expect(p.s.inventory.wood).toBe(before + MINIGAMES.yield.perfect);
    // Another player can't answer my round.
    advance(1200);
    const r3 = [...c.inbox].reverse().find((m) => m.t === "mg_round");
    const other = await createGuest(db);
    if (r3?.t === "mg_round") expect(() => game.minigameInput(other.userId, r3.round.id, 500)).toThrow();
    void params;
  }, 30_000);
});

describe("Bubble Roulette", () => {
  it("plays a full server-authoritative match with turn checks and single settlement", async () => {
    const ua = await createGuest(db), ub = await createGuest(db);
    const hq = game.world.pois.find((q) => q.id === "forest")!; // battles are off in the village
    const a = await spawn(ua.userId, hq.tx, hq.ty), b = await spawn(ub.userId, hq.tx + 1, hq.ty);
    const ca = client(ua.userId), cb = client(ub.userId);
    game.join(ca); game.join(cb);
    await game.handle(ca, { t: "br_challenge", petId: a.id, targetId: b.id });
    const invite = cb.inbox.find((m) => m.t === "br_invite");
    expect(invite?.t).toBe("br_invite");
    if (invite?.t !== "br_invite") return;
    // Only the challenged player can accept.
    expect(() => game.arena.respond(ca, invite.matchId, true)).toThrow();
    game.arena.respond(cb, invite.matchId, true);
    const m = game.arena.get(invite.matchId)!;
    expect(m.state).toBe("active");
    expect(m.hp.a).toBe(toBattleHp(a.s.hp, a.stats.maxHp));
    expect(a.busy && b.busy).toBe(true); // locked in place
    let guard = 0, splashes = 0;
    while (m.state === "active" && guard++ < 200) {
      const turnClient = m.turn === "a" ? ca : cb;
      const waitClient = m.turn === "a" ? cb : ca;
      // Acting out of turn or with a stale turn number fails.
      expect(() => game.arena.action(waitClient, m.id, "opponent", m.turnNo)).toThrow();
      expect(() => game.arena.action(turnClient, m.id, "opponent", m.turnNo - 1)).toThrow();
      const slotsBefore = m.chamber.length - m.pos;
      const hpBefore = { ...m.hp };
      const loaded = m.chamber[m.pos]!;
      game.arena.action(turnClient, m.id, "opponent", m.turnNo);
      if (loaded) {
        splashes++;
        const target = m.last!.target;
        expect(hpBefore[target] - m.hp[target]).toBe(Math.min(BUBBLE.splashHp, hpBefore[target]));
        if (m.state === "active") expect(m.chamber.length - m.pos).toBe(6); // reloaded
      } else {
        expect(m.hp).toEqual(hpBefore);
        expect(m.chamber.length - m.pos).toBe(slotsBefore - 1);
      }
    }
    expect(m.state).toBe("finished");
    expect(splashes).toBeGreaterThanOrEqual(1);
    const loser = m.winner === "a" ? b : a;
    expect(loser.s.hp).toBe(0);
    expect(loser.s.status).toBe("knocked_out");
    expect(a.busy || b.busy).toBe(false);
    expect(a.matchId ?? b.matchId).toBeNull();
    await new Promise((r) => setTimeout(r, 300));
    const row = await db.query(`SELECT mode, winner FROM battles WHERE id = $1`, [m.id]);
    expect(row.rows[0]).toMatchObject({ mode: "bubble" });
  }, 30_000);

  it("two missed turns forfeit; one missed turn just passes", async () => {
    const ua = await createGuest(db), ub = await createGuest(db);
    const hq = game.world.pois.find((q) => q.id === "forest")!; // battles are off in the village
    const a = await spawn(ua.userId, hq.tx - 2, hq.ty), b = await spawn(ub.userId, hq.tx - 1, hq.ty);
    const ca = client(ua.userId), cb = client(ub.userId);
    game.join(ca); game.join(cb);
    await game.handle(ca, { t: "br_challenge", petId: a.id, targetId: b.id });
    const invite = cb.inbox.find((m) => m.t === "br_invite");
    if (invite?.t !== "br_invite") throw new Error("no invite");
    game.arena.respond(cb, invite.matchId, true);
    const m = game.arena.get(invite.matchId)!;
    const first = m.turn;
    advance(BUBBLE.turnMs + 200);
    expect(m.state).toBe("active");
    expect(m.turn).not.toBe(first);
    // The other side acts, then the first side times out again → forfeit.
    game.arena.action(m.turn === "a" ? ca : cb, m.id, "self", m.turnNo);
    if (m.state === "active") {
      advance(BUBBLE.turnMs + 200);
      expect(m.state).toBe("finished");
      expect(m.winner).not.toBe(first);
    }
    expect(ECONOMY.battle.realTokenPvp.enabled).toBe(false);
  }, 30_000);
});

describe("bandits", () => {
  it("chase a loaded pet in the wild and steal its bag; ignore empty bags and the village", async () => {
    const u = await createGuest(db);
    const forest = game.world.pois.find((q) => q.id === "forest")!;
    const p = await spawn(u.userId, forest.tx, forest.ty);
    const b = game.bandits.list.find((x) => x.home === "forest")!;
    b.x = p.s.x + 20; b.y = p.s.y; b.state = "wander"; b.calmUntil = 0; b.nextThink = 0; b.path = [];
    // Empty bag: ignored.
    game.bandits.step(0.1, t);
    expect(b.state).toBe("wander");
    p.s.inventory.wood = 120;
    b.nextThink = 0;
    const rnd = Math.random;
    Math.random = () => 0.99; // force the bandit to win the scuffle
    for (let i = 0; i < 20 && p.s.inventory.wood > 0; i++) { t += 100; game.bandits.step(0.1, t); }
    Math.random = rnd;
    expect(p.s.inventory.wood).toBe(0);
    expect(b.state).toBe("flee");
    // A brave challenge the pet wins keeps the bag.
    p.s.inventory.herbs = 40;
    b.state = "wander"; b.x = p.s.x + 10; b.y = p.s.y;
    Math.random = () => 0.01;
    game.bandits.challenge(p, b.id, t);
    Math.random = rnd;
    expect(p.s.inventory.herbs).toBe(40);
    // A pet in Paw Village is safe even right next to a bandit.
    const hq = game.world.pois.find((q) => q.id === "hq")!;
    const q = await spawn(u.userId, hq.tx, hq.ty + 4);
    q.s.inventory.fish = 50;
    b.x = q.s.x + 10; b.y = q.s.y; b.state = "wander"; b.calmUntil = 0; b.nextThink = 0;
    for (let i = 0; i < 10; i++) { t += 100; game.bandits.step(0.1, t); }
    expect(q.s.inventory.fish).toBe(50);
  }, 30_000);
});

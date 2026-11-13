import { describe, expect, it, beforeAll } from "vitest";
import {
  BUBBLE, chopMarker, ECONOMY, fishX, generateGenome, gradeRound, makeChamber, makeRound, mineAngle, MINIGAMES, randomSeedHex,
  standSpot, tileCenter, toBattleHp, tokens, type ChopRound, type MineRound, type PullRound, type ServerMsg,
} from "@catchami/shared";
import { openDb, type Db } from "../src/db/index.ts";
import { ensureGenesis } from "../src/ledger/treasury.ts";
import { acct, balanceOf, post, transfer } from "../src/ledger/ledger.ts";
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
  it("chambers hold the configured splashes in 6 slots and are deterministic", () => {
    for (let i = 0; i < 50; i++) {
      const c = makeChamber(seed, "m", i);
      expect(c.length).toBe(BUBBLE.slots);
      expect(c.filter(Boolean).length).toBe(BUBBLE.loaded);
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
    expect(p.s.energy).toBeCloseTo(energy - MINIGAMES.energyPerAttempt - ECONOMY.resources.wood.energy * MINIGAMES.yield.perfect, 5);
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
    for (const p of [a, b]) {
      await db.tx((tx) => post(tx, { idem: `test-fund:${p.id}`, kind: "pet_fund", postings: transfer(acct.chain, acct.pet(p.id), tokens(1_000_000)) }));
      await game.refreshBalance(p);
      p.s.inventory.herbs = 100;
      p.s.energy = 1000; p.s.hunger = 0;
    }
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
      const hpBefore = { ...m.hp };
      const loaded = m.chamber[m.pos]!;
      const rest = m.chamber.slice(m.pos + 1);
      const expectLeft = rest.length && rest.some(Boolean) ? rest.length : BUBBLE.slots; // reload only when no loaded bubbles remain
      game.arena.action(turnClient, m.id, "opponent", m.turnNo);
      if (loaded) {
        splashes++;
        const target = m.last!.target;
        expect(hpBefore[target] - m.hp[target]).toBe(Math.min(BUBBLE.splashHp, hpBefore[target]));
      } else {
        expect(m.hp).toEqual(hpBefore);
      }
      if (m.state === "active") expect(m.chamber.length - m.pos).toBe(expectLeft);
    }
    expect(m.state).toBe("finished");
    expect(splashes).toBeGreaterThanOrEqual(1);
    const loser = m.winner === "a" ? b : a;
    expect(loser.s.hp).toBe(0);
    expect(loser.s.status).toBe("knocked_out");
    await new Promise((r) => setTimeout(r, 500));
    expect(a.busy || b.busy).toBe(false);
    expect(a.matchId ?? b.matchId).toBeNull();
    const row = await db.query(`SELECT mode, winner FROM battles WHERE id = $1`, [m.id]);
    expect(row.rows[0]).toMatchObject({ mode: "bubble" });
    // Spoils: a share of the loser's coins above the protected purse (minus the HQ fee) and of its bag.
    const winnerPet = m.winner === "a" ? a : b;
    const loot = m.loot!;
    expect(loot.shareBps).toBeGreaterThanOrEqual(ECONOMY.battle.stake.minShareBps);
    expect(loot.shareBps).toBeLessThanOrEqual(ECONOMY.battle.stake.maxShareBps);
    const take = ((tokens(1_000_000) - ECONOMY.battle.stake.protectedCoins) * BigInt(loot.shareBps)) / 10_000n;
    const fee = (take * BigInt(ECONOMY.battle.stake.feeBps)) / 10_000n;
    expect(BigInt(loot.coins)).toBe(take - fee);
    expect(BigInt(loot.fee)).toBe(fee);
    expect((await db.tx((tx) => balanceOf(tx, acct.pet(loser.id)))).balance).toBe(tokens(1_000_000) - take);
    expect((await db.tx((tx) => balanceOf(tx, acct.pet(winnerPet.id)))).balance).toBe(tokens(1_000_000) + take - fee);
    expect(loser.s.inventory.herbs + winnerPet.s.inventory.herbs).toBe(200);
    expect(winnerPet.s.inventory.herbs - 100).toBe(Math.floor((100 * loot.shareBps) / 10_000));
    // Both paid the match's energy and hunger.
    expect(a.s.energy).toBeLessThanOrEqual(1000 - ECONOMY.battle.matchEnergy);
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
    advance(BUBBLE.turnMs + BUBBLE.firstTurnGraceMs + 200); // the first turn has extra reading time
    expect(m.state).toBe("active");
    expect(m.turn).not.toBe(first);
    // A self-splash that comes up empty keeps the turn.
    m.chamber = [false, true, true, true, false, false]; m.pos = 0;
    const me = m.turn;
    game.arena.action(me === "a" ? ca : cb, m.id, "self", m.turnNo);
    expect(m.turn).toBe(me);
    expect(m.last).toMatchObject({ again: true, loaded: false });
    // The other side acts, then the first side times out again → forfeit.
    game.arena.action(m.turn === "a" ? ca : cb, m.id, "opponent", m.turnNo);
    if (m.state === "active") {
      advance(BUBBLE.turnMs + 200);
      expect(m.state).toBe("finished");
      expect(m.winner).not.toBe(first);
    }
    expect(ECONOMY.battle.realTokenPvp.enabled).toBe(false);
  }, 30_000);
});

describe("rivals", () => {
  it("demo rivals walk up to an idle pet in the wild and invite it to Bubble Roulette; gathering pets are left alone", async () => {
    const u = await createGuest(db);
    const forest = game.world.pois.find((q) => q.id === "forest")!;
    const p = await spawn(u.userId, forest.tx, forest.ty);
    p.s.energy = 1000; p.s.hunger = 0; p.s.lastBattleAt = 0;
    const c = client(u.userId);
    game.join(c);
    const b = game.bandits.list.find((x) => x.home === "forest")!;
    expect(game.bandits.list.some((x) => x.id === "bandit-practice")).toBe(true);
    // Gathering: the rival hangs around but doesn't challenge.
    p.task = { kind: "gather", nodeId: "wood-1", endsAt: null, repeat: true };
    b.x = p.s.x + 20; b.y = p.s.y; b.state = "wander"; b.calmUntil = 0; b.nextThink = 0; b.path = [];
    for (let i = 0; i < 10; i++) { t += 100; game.bandits.step(0.1, t); }
    expect(c.inbox.some((m) => m.t === "br_invite")).toBe(false);
    // Idle: it challenges.
    p.task = null;
    for (let i = 0; i < 20 && !c.inbox.some((m) => m.t === "br_invite"); i++) { t += 100; game.bandits.step(0.1, t); }
    const inv = c.inbox.find((m) => m.t === "br_invite");
    if (inv?.t !== "br_invite") throw new Error("no rival invite");
    expect(b.state).toBe("duel");
    game.arena.respond(c, inv.matchId, true);
    const m = game.arena.get(inv.matchId)!;
    expect(m.state).toBe("active");
    expect(m.turn).toBe("b"); // the player goes first
    expect(game.arena.get(inv.matchId)!.bot?.practice).toBe(false);
    // Play it out: the rival takes its own turns.
    for (let i = 0; i < 400 && m.state === "active"; i++) {
      if (m.turn === "b") game.arena.action(c, m.id, "opponent", m.turnNo);
      t += 1000; game.arena.tick(t);
    }
    expect(m.state).toBe("finished");
    expect(m.loot?.coins).toBe("0"); // demo rivals only put bags at stake
    expect(b.state).toBe("flee");
  }, 30_000);
});

describe("knockout (0 HP)", () => {
  it("a 0-HP pet can still walk and buy medicine straight away, but can't gather", async () => {
    const u = await createGuest(db);
    const forest = game.world.pois.find((q) => q.id === "forest")!;
    const p = await spawn(u.userId, forest.tx + 3, forest.ty + 3);
    await db.tx((tx) => post(tx, { idem: `test-fund:${p.id}`, kind: "pet_fund", postings: transfer(acct.chain, acct.pet(p.id), tokens(1_000_000)) }));
    await game.refreshBalance(p);
    p.s.hp = 0; p.s.status = "knocked_out"; p.s.energy = 1000; p.s.hunger = 0;
    const c = client(u.userId);
    game.join(c);
    c.controlled = p.id;
    const x0 = p.s.x, y0 = p.s.y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      await game.handle(c, { t: "move", dx, dy });
      advance(300);
      if (Math.hypot(p.s.x - x0, p.s.y - y0) > 0) break;
    }
    expect(Math.hypot(p.s.x - x0, p.s.y - y0)).toBeGreaterThan(0);
    expect(p.s.status).toBe("knocked_out");
    const node = game.world.nodes.find((n) => n.resource === "wood")!;
    await expect(game.handle(c, { t: "gather", petId: p.id, nodeId: node.id })).rejects.toMatchObject({ code: "ko" });
    await game.buy(p, "medicine", "ko-med-1");
    expect(p.s.status).toBe("active");
    expect(p.s.hp).toBeGreaterThan(0);
  }, 30_000);
});

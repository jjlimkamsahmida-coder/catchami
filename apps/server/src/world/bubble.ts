/**
 * Bubble Roulette — server-authoritative, turn-based PvP.
 *
 * State machine: invited → active (turns) → finished | cancelled.
 * The server alone holds the chamber (from the fair epoch RNG, so every
 * chamber is recomputable after the seed reveal), the turn order, battle HP,
 * timeouts and settlement. Clients send intents with the turn number they
 * acted on; stale/duplicate/out-of-turn actions are rejected.
 *
 * Published policies:
 *  - 15 s per turn. A missed turn passes to the opponent. Two missed turns in a
 *    row forfeits the match. Disconnecting doesn't pause the clock; reconnecting
 *    restores the match from the server.
 *  - Matches are non-redeemable (no tokens at stake). Real-token stakes stay
 *    disabled behind the legal gate (ECONOMY.battle.realTokenPvp + REAL_PVP_APPROVED).
 *  - An unfinished match is voided (no HP change) if the server restarts.
 */
import { BUBBLE, ECONOMY, fromBattleHp, makeChamber, Rng, toBattleHp, type BubbleMatchView, type BubbleSide } from "@catchami/shared";
import { newId } from "../auth.ts";
import type { Game, GameClient } from "./game.ts";
import { GameError } from "./game.ts";
import type { PetRt } from "./types.ts";

type SideKey = "a" | "b";

interface Match {
  id: string;
  state: BubbleMatchView["state"];
  pets: Record<SideKey, PetRt>;
  hp: Record<SideKey, number>;
  startHp: Record<SideKey, number>;
  turn: SideKey;
  turnNo: number;
  turnEndsAt: number;
  chamberNo: number;
  chamber: boolean[];
  pos: number;
  missed: Record<SideKey, number>;
  last: BubbleMatchView["last"];
  winner: SideKey | null;
  reason: string;
  epoch: { id: number; seed: string; commitment: string };
  inviteExpiresAt: number;
  log: Array<{ turnNo: number; by: SideKey; target: SideKey | "timeout"; chamberNo: number; slot: number; loaded: boolean; hp: Record<SideKey, number> }>;
  settled: boolean;
  doneAt: number;
}

const other = (s: SideKey): SideKey => (s === "a" ? "b" : "a");

export class BubbleArena {
  private matches = new Map<string, Match>();
  game: Game;
  constructor(game: Game) { this.game = game; }

  private online(userId: string) { for (const c of this.game.clients) if (c.userId === userId) return true; return false; }

  private sideOf(m: Match, userId: string): SideKey | null {
    return m.pets.a.ownerId === userId ? "a" : m.pets.b.ownerId === userId ? "b" : null;
  }

  private view(m: Match, userId: string | null): BubbleMatchView {
    const side = (k: SideKey): BubbleSide => {
      const p = m.pets[k];
      return { petId: p.id, ownerId: p.ownerId, ownerName: p.ownerName, name: p.name, species: p.species, rarity: p.rarity, sticker: p.sticker, look: p.genome.look, battleHp: m.hp[k], startHp: m.startHp[k], connected: this.online(p.ownerId) };
    };
    return {
      id: m.id, state: m.state, a: side("a"), b: side("b"), you: userId ? this.sideOf(m, userId) : null,
      turn: m.turn, turnNo: m.turnNo, turnEndsAt: m.turnEndsAt, chamberNo: m.chamberNo,
      slotsLeft: m.chamber.length - m.pos, splashesLeft: m.chamber.slice(m.pos).filter(Boolean).length,
      last: m.last, winner: m.winner, reason: m.reason, epoch: m.epoch.id, commitment: m.epoch.commitment, mode: "nonredeemable",
    };
  }

  private push(m: Match) {
    for (const c of this.game.clients) {
      if (c.userId === m.pets.a.ownerId || c.userId === m.pets.b.ownerId) c.send({ t: "br_state", match: this.view(m, c.userId) });
    }
  }

  /** Re-send live matches to a (re)connected client so a refresh/network drop recovers the match. */
  sync(c: GameClient) {
    for (const m of this.matches.values()) {
      if (this.sideOf(m, c.userId) && (m.state === "invited" || m.state === "active" || this.game.now() - m.doneAt < 30_000)) {
        c.send({ t: "br_state", match: this.view(m, c.userId) });
        if (m.state === "invited" && m.pets.b.ownerId === c.userId) this.sendInvite(m);
      }
    }
  }

  presence() { for (const m of this.matches.values()) if (m.state === "active") this.push(m); }

  private eligible(p: PetRt, now: number): string | null {
    if (p.matchId) return "already in a match";
    if (p.busy) return "busy";
    if (p.s.status !== "active" && p.s.status !== "sleeping") return "not active";
    if (toBattleHp(p.s.hp, p.stats.maxHp) < BUBBLE.minHp) return "too low on HP";
    if (now - p.s.lastBattleAt < ECONOMY.battle.petCooldownSec * 1000) return "catching breath";
    return null;
  }

  challenge(c: GameClient, a: PetRt, b: PetRt) {
    const now = this.game.now();
    if (this.game.flags.pauseBattles) throw new GameError("paused", "Battles are paused by operations");
    if (a.ownerId === b.ownerId) throw new GameError("same_owner", "Your own pets can't battle each other");
    if (Math.hypot(a.s.x - b.s.x, a.s.y - b.s.y) > ECONOMY.battle.challengeRangePx) throw new GameError("too_far", `Get closer to ${b.name}`);
    const ea = this.eligible(a, now), eb = this.eligible(b, now);
    if (ea) throw new GameError("not_eligible", `${a.name} is ${ea}`);
    if (eb) throw new GameError("not_eligible", `${b.name} is ${eb}`);
    if (b.s.strategy.battle === "avoid") throw new GameError("declined", `${b.name}'s owner isn't accepting battles`);
    if (!this.online(b.ownerId)) throw new GameError("offline", `${b.name}'s owner isn't online — Bubble Roulette needs both players`);
    const repeat = Math.max(a.s.recentOpponents[b.id] ?? 0, b.s.recentOpponents[a.id] ?? 0);
    if (now - repeat < ECONOMY.battle.sameOpponentCooldownSec * 1000) throw new GameError("repeat", `${a.name} played ${b.name} recently`);
    const epoch = this.game.epochNow();
    if (!epoch) throw new GameError("busy", "Arena is warming up — try again in a moment");
    const id = newId("br");
    const m: Match = {
      id, state: "invited", pets: { a, b }, hp: { a: toBattleHp(a.s.hp, a.stats.maxHp), b: toBattleHp(b.s.hp, b.stats.maxHp) },
      startHp: { a: 0, b: 0 }, turn: "a", turnNo: 0, turnEndsAt: 0, chamberNo: 0, chamber: [], pos: 0, missed: { a: 0, b: 0 },
      last: null, winner: null, reason: "Waiting for the opponent to accept", epoch: { id: epoch.id, seed: epoch.seed, commitment: epoch.commitment },
      inviteExpiresAt: now + BUBBLE.inviteMs, log: [], settled: false, doneAt: 0,
    };
    m.startHp = { ...m.hp };
    this.matches.set(id, m);
    a.matchId = id; b.matchId = id; // reserved while the invite is open
    this.sendInvite(m);
    this.push(m);
    void c;
  }

  private sendInvite(m: Match) {
    const a = m.pets.a;
    for (const cl of this.game.clients) if (cl.userId === m.pets.b.ownerId) cl.send({
      t: "br_invite", matchId: m.id, toPetId: m.pets.b.id, expiresAt: m.inviteExpiresAt,
      from: { petId: a.id, name: a.name, ownerName: a.ownerName, species: a.species, rarity: a.rarity, sticker: a.sticker, look: a.genome.look },
    });
  }

  respond(c: GameClient, matchId: string, accept: boolean) {
    const m = this.matches.get(matchId);
    if (!m || m.state !== "invited") throw new GameError("gone", "That invitation has expired");
    if (m.pets.b.ownerId !== c.userId) throw new GameError("not_yours", "Only the challenged player can answer");
    if (!accept) return this.cancel(m, `${m.pets.b.name}'s owner declined`);
    const now = this.game.now();
    for (const p of [m.pets.a, m.pets.b]) {
      const why = (() => { const saved = p.matchId; p.matchId = null; const r = this.eligible(p, now); p.matchId = saved; return r; })();
      if (why) return this.cancel(m, `${p.name} is ${why}`);
    }
    // Lock both pets in place for the match.
    for (const p of [m.pets.a, m.pets.b]) { p.busy = true; p.path = []; p.moveDir = null; p.task = null; p.round = null; p.activity = "Playing Bubble Roulette"; }
    m.hp = { a: toBattleHp(m.pets.a.s.hp, m.pets.a.stats.maxHp), b: toBattleHp(m.pets.b.s.hp, m.pets.b.stats.maxHp) };
    m.startHp = { ...m.hp };
    m.turn = new Rng(m.epoch.seed, `bubble:${m.id}:first`).int(2) === 0 ? "a" : "b";
    m.chamber = makeChamber(m.epoch.seed, m.id, 0);
    m.pos = 0;
    m.state = "active";
    m.turnNo = 1;
    m.turnEndsAt = now + BUBBLE.turnMs;
    m.reason = "";
    this.push(m);
  }

  action(c: GameClient, matchId: string, target: "self" | "opponent", turnNo: number) {
    const m = this.matches.get(matchId);
    if (!m || m.state !== "active") throw new GameError("gone", "This match is over");
    const me = this.sideOf(m, c.userId);
    if (!me) throw new GameError("not_yours", "You're not in this match");
    if (me !== m.turn) throw new GameError("not_turn", "Wait for your turn");
    if (turnNo !== m.turnNo) throw new GameError("stale", "That action was already resolved");
    if (target !== "self" && target !== "opponent") throw new GameError("target", "Pick a target");
    m.missed[me] = 0;
    this.resolve(m, me, target === "self" ? me : other(me));
  }

  /** Fire the next slot. Synchronous: no other action can interleave. */
  private resolve(m: Match, by: SideKey, target: SideKey) {
    const slot = m.pos;
    const loaded = m.chamber[slot]!;
    m.pos++;
    let reloaded = false;
    if (loaded) m.hp[target] = Math.max(0, m.hp[target] - BUBBLE.splashHp);
    if (loaded || m.pos >= m.chamber.length) {
      m.chamberNo++;
      m.chamber = makeChamber(m.epoch.seed, m.id, m.chamberNo);
      m.pos = 0;
      reloaded = true;
    }
    m.log.push({ turnNo: m.turnNo, by, target, chamberNo: reloaded ? m.chamberNo - 1 : m.chamberNo, slot, loaded, hp: { ...m.hp } });
    m.last = { by, target, loaded, reloaded, turnNo: m.turnNo };
    if (m.hp[target] <= 0) return this.finish(m, other(target), `${m.pets[target].name} got soaked!`);
    m.turn = other(m.turn);
    m.turnNo++;
    m.turnEndsAt = this.game.now() + BUBBLE.turnMs;
    this.push(m);
  }

  forfeit(c: GameClient, matchId: string) {
    const m = this.matches.get(matchId);
    if (!m) throw new GameError("gone", "This match is over");
    const me = this.sideOf(m, c.userId);
    if (!me) throw new GameError("not_yours", "You're not in this match");
    if (m.state === "invited") return this.cancel(m, me === "a" ? "Challenge withdrawn" : "Declined");
    if (m.state !== "active") return;
    this.finish(m, other(me), `${m.pets[me].name}'s owner left the match`);
  }

  tick(now: number) {
    for (const m of this.matches.values()) {
      if (m.state === "invited" && now > m.inviteExpiresAt) this.cancel(m, "The invitation expired");
      else if (m.state === "active" && now > m.turnEndsAt) {
        const late = m.turn;
        m.missed[late]++;
        m.log.push({ turnNo: m.turnNo, by: late, target: "timeout", chamberNo: m.chamberNo, slot: -1, loaded: false, hp: { ...m.hp } });
        if (m.missed[late] >= BUBBLE.maxMissedTurns) { this.finish(m, other(late), `${m.pets[late].name} ran out of time twice`); continue; }
        m.last = null;
        m.reason = `${m.pets[late].name} missed a turn`;
        m.turn = other(late);
        m.turnNo++;
        m.turnEndsAt = now + BUBBLE.turnMs;
        this.push(m);
      } else if ((m.state === "finished" || m.state === "cancelled") && now - m.doneAt > 60_000) {
        this.matches.delete(m.id);
      }
    }
  }

  private unlock(m: Match) {
    for (const p of [m.pets.a, m.pets.b]) { if (p.matchId === m.id) p.matchId = null; if (m.state !== "invited") p.busy = false; }
  }

  private cancel(m: Match, reason: string) {
    const wasActive = m.state === "active";
    m.state = "cancelled";
    m.reason = reason;
    m.doneAt = this.game.now();
    for (const p of [m.pets.a, m.pets.b]) { if (p.matchId === m.id) p.matchId = null; if (wasActive) p.busy = false; }
    this.push(m);
  }

  /** Settle exactly once: HP, knockouts, records, audit log. */
  private finish(m: Match, winner: SideKey, reason: string) {
    if (m.settled) return;
    m.settled = true;
    m.state = "finished";
    m.winner = winner;
    m.reason = reason;
    m.doneAt = this.game.now();
    const now = m.doneAt;
    const loser = other(winner);
    for (const k of ["a", "b"] as const) {
      const p = m.pets[k];
      // A match can only lower HP, never heal.
      p.s.hp = Math.min(p.s.hp, fromBattleHp(m.hp[k], p.stats.maxHp));
      p.s.lastBattleAt = now;
      p.s.recentOpponents = { ...p.s.recentOpponents, [m.pets[other(k)].id]: now };
      if (p.s.hp <= 0) { p.s.hp = 0; p.s.status = "knocked_out"; p.s.koUntil = now + ECONOMY.stats.knockoutCooldownSec * 1000; p.anim = "ko"; }
      p.dirty = true; p.metaDirty = true;
    }
    m.pets[winner].s.wins++;
    m.pets[loser].s.losses++;
    m.pets[winner].activity = `Won Bubble Roulette vs ${m.pets[loser].name}`;
    m.pets[loser].activity = `Got soaked by ${m.pets[winner].name}`;
    this.unlock(m);
    this.push(m);
    const inputs = { a: m.pets.a.id, b: m.pets.b.id, startHp: m.startHp, epoch: m.epoch.id, commitment: m.epoch.commitment, rule: BUBBLE };
    void this.game.db.tx(async (tx) => {
      await tx.query(
        `INSERT INTO battles (id, a_pet, b_pet, winner, epoch_id, label, inputs, result, stolen, mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'{}','bubble') ON CONFLICT (id) DO NOTHING`,
        [m.id, m.pets.a.id, m.pets.b.id, m.pets[winner].id, m.epoch.id, `bubble:${m.id}`, JSON.stringify(inputs), JSON.stringify({ log: m.log, finalHp: m.hp, reason })],
      );
      for (const p of [m.pets.a, m.pets.b]) await tx.query(`UPDATE pets SET state = $2, updated_at = now() WHERE id = $1`, [p.id, JSON.stringify(p.s)]);
    }).catch((e) => console.error("bubble settle failed", m.id, e));
    for (const k of ["a", "b"] as const) this.game.toastOwner(m.pets[k], k === winner ? "good" : "info", k === winner ? `${m.pets[k].name} won Bubble Roulette!` : `${m.pets[k].name} got soaked — good game!`);
  }

  /** Test/inspection helper. */
  get(id: string) { return this.matches.get(id); }
}

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
 *  - 6 bubbles, 3 loaded; a loaded bubble soaks for 50 battle HP. The launcher
 *    only reloads once it has no loaded bubbles (or no slots) left. Splashing
 *    yourself with an empty bubble keeps your turn.
 *  - 15 s per turn (+10 s on the first, to read the rules). A missed turn passes to the opponent. Two missed turns in a
 *    row forfeits the match. Disconnecting doesn't pause the clock; reconnecting
 *    restores the match from the server.
 *  - Spoils: the winner takes a luck-weighted random share (2%–15%) of the
 *    loser's coins above a protected purse and of each resource in their bag;
 *    a fee on the coins goes to HQ/team. Each match costs both pets energy and
 *    hunger, and the loser's HP drops to 0 (knockout).
 *  - An unfinished match is voided (no HP change) if the server restarts.
 */
import {
  battlesAllowed, battleTakeBps, BUBBLE, carryCapacity, computeTheft, ECONOMY, emptyInventory, formatTokens, fromBattleHp, makeChamber, RESOURCES, Rng,
  splitBps, toBattleHp, toWire, type BubbleMatchView, type BubbleSide,
} from "@catchami/shared";
import { acct, balanceOf, post } from "../ledger/ledger.ts";
import { newId } from "../auth.ts";
import type { Game, GameClient } from "./game.ts";
import { describeInv, GameError } from "./game.ts";
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
  /** Demo rival / tutorial coach: takes its own turns; the result goes back to the rival logic. */
  bot?: { banditId: string; practice: boolean; side: SideKey; actAt: number; firstAt?: number };
  /** Shots left this turn (1; an empty self-splash adds 2). */
  actionsLeft: number;
  loot?: BubbleMatchView["loot"];
}

const other = (s: SideKey): SideKey => (s === "a" ? "b" : "a");
const isBot = (p: PetRt) => p.ownerId.startsWith("bot:");

export interface BotInfo { banditId: string; name: string; ownerName: string; art: string; practice: boolean }

/** A stand-in pet for a demo rival / Coach Kiki. Demo rivals carry a small random bag (their stake). */
function makeBotPet(bot: BotInfo): PetRt {
  const bag = emptyInventory();
  if (!bot.practice) {
    const r = RESOURCES[Math.floor(Math.random() * RESOURCES.length)]!;
    bag[r] = Math.round((60 + Math.random() * 140) / ECONOMY.resources[r].weight);
  }
  return {
    id: `bot-${bot.banditId}`, ownerId: `bot:${bot.banditId}`, ownerName: bot.ownerName, name: bot.name, species: "cat", rarity: "rare",
    sticker: `/assets/gen/${bot.art}.png`, genome: { look: { hue: 30, outline: 0, pattern: 0, bounce: 100 } },
    stats: { maxHp: 1000, luck: 100, carry: 60 }, s: { hp: 1000, lastBattleAt: 0, recentOpponents: {}, wins: 0, losses: 0, status: "active", inventory: bag },
    matchId: null, busy: true, activity: "", anim: "idle", dirty: false, metaDirty: false,
  } as unknown as PetRt;
}

export class BubbleArena {
  private matches = new Map<string, Match>();
  game: Game;
  constructor(game: Game) { this.game = game; }

  private online(userId: string) { if (userId.startsWith("bot:")) return true; for (const c of this.game.clients) if (c.userId === userId) return true; return false; }

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
      last: m.last, winner: m.winner, reason: m.reason, epoch: m.epoch.id, commitment: m.epoch.commitment, mode: m.bot ? (m.bot.practice ? "practice" : "demo") : "stakes", loot: m.loot ?? null, actionsLeft: m.actionsLeft,
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
    if (p.s.energy < ECONOMY.battle.minEnergy) return "too tired — needs a meal or a nap";
    if (p.s.hunger >= ECONOMY.battle.maxHunger) return "too hungry to battle";
    if (p.listed) return "listed for sale";
    if (p.task?.kind === "gather" || p.round) return "busy gathering";
    if (!battlesAllowed(this.game.world, p.s.x, p.s.y)) return "in Paw Village — battles only happen in the Forest and Mining Valley";
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
      inviteExpiresAt: now + BUBBLE.inviteMs, log: [], settled: false, doneAt: 0, actionsLeft: 1,
    };
    m.startHp = { ...m.hp };
    this.matches.set(id, m);
    a.matchId = id; b.matchId = id;
    this.begin(m); // forced: no accept/decline
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
    this.begin(m);
  }

  /** Start the match (battles are forced: a challenge starts straight away). */
  private begin(m: Match) {
    const now = this.game.now();
    for (const p of [m.pets.a, m.pets.b]) {
      if (isBot(p)) continue;
      if (p.task?.kind === "gather") { p.task = null; p.round = null; } // agreeing to battle stops gathering
      const why = (() => { const saved = p.matchId; p.matchId = null; const r = this.eligible(p, now); p.matchId = saved; return r; })();
      if (why) return this.cancel(m, `${p.name} is ${why}`);
    }
    // Lock both pets in place for the match.
    for (const p of [m.pets.a, m.pets.b]) {
      if (isBot(p)) continue;
      p.busy = true; p.path = []; p.moveDir = null; p.task = null; p.round = null; p.activity = "Playing Bubble Roulette";
      // Battling is hard work: energy and hunger, on top of the HP it costs.
      p.s.energy = Math.max(0, p.s.energy - ECONOMY.battle.matchEnergy);
      p.s.hunger = Math.min(ECONOMY.stats.hungerMax, p.s.hunger + ECONOMY.battle.matchHunger);
      p.dirty = true; p.metaDirty = true;
    }
    m.hp = { a: toBattleHp(m.pets.a.s.hp, m.pets.a.stats.maxHp), b: toBattleHp(m.pets.b.s.hp, m.pets.b.stats.maxHp) };
    m.startHp = { ...m.hp };
    m.turn = m.bot ? other(m.bot.side) : new Rng(m.epoch.seed, `bubble:${m.id}:first`).int(2) === 0 ? "a" : "b";
    m.chamber = makeChamber(m.epoch.seed, m.id, 0);
    m.pos = 0;
    m.state = "active";
    m.turnNo = 1;
    m.actionsLeft = 1;
    m.turnEndsAt = now + BUBBLE.turnMs + BUBBLE.firstTurnGraceMs;
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
    if (m.pos >= m.chamber.length || !m.chamber.slice(m.pos).some(Boolean)) {
      m.chamberNo++;
      m.chamber = makeChamber(m.epoch.seed, m.id, m.chamberNo);
      m.pos = 0;
      reloaded = true;
    }
    m.log.push({ turnNo: m.turnNo, by, target, chamberNo: reloaded ? m.chamberNo - 1 : m.chamberNo, slot, loaded, hp: { ...m.hp } });
    const again = target === by && !loaded; // brave self-splash that came up empty: 2 extra shots
    m.actionsLeft = m.actionsLeft - 1 + (again ? 2 : 0);
    m.last = { by, target, loaded, reloaded, again, turnNo: m.turnNo };
    if (m.hp[target] <= 0) return this.finish(m, other(target), `${m.pets[target].name} got soaked!`);
    if (m.actionsLeft <= 0) { m.turn = other(m.turn); m.actionsLeft = 1; }
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
      if (m.bot && m.state === "active" && m.turn === m.bot.side) {
        if (!m.bot.actAt) m.bot.actAt = now + 1400 + Math.random() * 900; // "thinking"
        if (now >= m.bot.actAt) {
          m.bot.actAt = 0;
          const slots = m.chamber.length - m.pos, splashes = m.chamber.slice(m.pos).filter(Boolean).length;
          // Readable play: odds of a splash below 50% → try a self-splash for an extra turn, otherwise aim at you.
          const p = splashes / Math.max(1, slots);
          const target = splashes === 0 || (p < 0.5 && Math.random() < 0.7) ? m.bot.side : other(m.bot.side);
          this.resolve(m, m.bot.side, target);
        }
        continue;
      }
      if (m.state === "invited" && now > m.inviteExpiresAt) this.cancel(m, "The invitation expired");
      else if (m.state === "active" && now > m.turnEndsAt) {
        const late = m.turn;
        m.missed[late]++;
        m.log.push({ turnNo: m.turnNo, by: late, target: "timeout", chamberNo: m.chamberNo, slot: -1, loaded: false, hp: { ...m.hp } });
        if (m.missed[late] >= BUBBLE.maxMissedTurns) { this.finish(m, other(late), `${m.pets[late].name} ran out of time twice`); continue; }
        m.last = null;
        m.reason = `${m.pets[late].name} missed a turn`;
        m.turn = other(late);
        m.actionsLeft = 1;
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
    for (const p of [m.pets.a, m.pets.b]) { if (p.matchId === m.id) p.matchId = null; if (wasActive && !isBot(p)) p.busy = false; }
    this.push(m);
    if (m.bot) this.game.bandits.botInviteDone(m.bot.banditId);
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
      if (m.bot && (m.bot.practice || k === m.bot.side)) { p.s.lastBattleAt = m.bot.practice ? 0 : now; continue; }
      // A match can only lower HP, never heal.
      p.s.hp = Math.min(p.s.hp, fromBattleHp(m.hp[k], p.stats.maxHp));
      p.s.lastBattleAt = now;
      p.s.recentOpponents = { ...p.s.recentOpponents, [m.pets[other(k)].id]: now };
      if (p.s.hp <= 0) { p.s.hp = 0; p.s.status = "knocked_out"; p.s.koUntil = null; p.anim = "ko"; p.task = null; p.round = null; }
      p.dirty = true; p.metaDirty = true;
    }
    if (m.bot) {
      const player = other(m.bot.side);
      const P = m.pets[player], B = m.pets[m.bot.side];
      const won = winner === player;
      if (!m.bot.practice) {
        P.s[won ? "wins" : "losses"]++;
        // Demo rivals only put bags at stake (no coins appear from nowhere, none vanish to a fake player).
        const shareBps = battleTakeBps(won ? P.stats.luck : 100, won ? 100 : P.stats.luck, new Rng(m.epoch.seed, `bubble:${m.id}:spoils`).int(10_001) / 10_000);
        let items = emptyInventory();
        if (won) {
          items = computeTheft(B.s.inventory, P.s.inventory, carryCapacity(P.stats), shareBps);
          for (const r of RESOURCES) P.s.inventory[r] += items[r];
        } else {
          items = computeTheft(P.s.inventory, emptyInventory(), Number.MAX_SAFE_INTEGER, shareBps);
          for (const r of RESOURCES) P.s.inventory[r] -= items[r];
        }
        m.loot = { coins: "0", fee: "0", items, shareBps };
        P.activity = won ? `Won Bubble Roulette vs ${B.name}` : `Got soaked by ${B.name}`;
        P.dirty = true; P.metaDirty = true;
        const got = RESOURCES.some((r) => items[r]) ? describeInv(items) : "";
        this.game.toastOwner(P, won ? "good" : "bad", won ? (got ? `${P.name} won and took ${got}!` : `${P.name} won Bubble Roulette!`) : got ? `${B.name} won and took ${got}` : `${B.name} won — good game!`);
      }
      this.unlock(m);
      this.push(m);
      this.game.bandits.botMatchDone(m.bot.banditId, P.id, won);
      return;
    }
    const W = m.pets[winner], L = m.pets[loser];
    W.s.wins++;
    L.s.losses++;
    W.activity = `Won Bubble Roulette vs ${L.name}`;
    L.activity = `Got soaked by ${W.name}`;
    // Spoils: a luck-weighted, fair-rolled share of the loser's bag and coins.
    const shareBps = battleTakeBps(W.stats.luck, L.stats.luck, new Rng(m.epoch.seed, `bubble:${m.id}:spoils`).int(10_001) / 10_000);
    const items = computeTheft(L.s.inventory, W.s.inventory, carryCapacity(W.stats), shareBps);
    for (const r of RESOURCES) { L.s.inventory[r] -= items[r]; W.s.inventory[r] += items[r]; }
    const st = ECONOMY.battle.stake;
    let coins = 0n, fee = 0n;
    const inputs = { a: m.pets.a.id, b: m.pets.b.id, startHp: m.startHp, epoch: m.epoch.id, commitment: m.epoch.commitment, rule: BUBBLE, shareBps };
    void this.game.db.tx(async (tx) => {
      const bal = await balanceOf(tx, acct.pet(L.id));
      const stakeable = bal.available > st.protectedCoins ? bal.available - st.protectedCoins : 0n;
      const take = (stakeable * BigInt(shareBps)) / 10_000n;
      if (take > 0n) {
        const f = (take * BigInt(st.feeBps)) / 10_000n;
        const fs = splitBps(f, st.feeSplit, "hq");
        const postings = [
          { account: acct.pet(L.id), amount: -take },
          { account: acct.pet(W.id), amount: take - f },
          { account: acct.hq, amount: fs.hq },
          { account: acct.team, amount: fs.team },
        ].filter((x) => x.amount !== 0n);
        await post(tx, { idem: `bubble-win:${m.id}`, kind: "battle_win", postings, meta: { matchId: m.id, winner: W.id, loser: L.id, shareBps } });
        coins = take - f; fee = f;
      }
      await tx.query(
        `INSERT INTO battles (id, a_pet, b_pet, winner, epoch_id, label, inputs, result, stolen, mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'bubble') ON CONFLICT (id) DO NOTHING`,
        [m.id, m.pets.a.id, m.pets.b.id, W.id, m.epoch.id, `bubble:${m.id}`, JSON.stringify(inputs), JSON.stringify({ log: m.log, finalHp: m.hp, reason }), JSON.stringify({ ...items, coins: coins.toString(), fee: fee.toString(), shareBps })],
      );
      for (const p of [m.pets.a, m.pets.b]) await tx.query(`UPDATE pets SET state = $2, updated_at = now() WHERE id = $1`, [p.id, JSON.stringify(p.s)]);
    }).catch((e) => { console.error("bubble settle failed", m.id, e); coins = 0n; fee = 0n; })
      .finally(async () => {
        m.loot = { coins: toWire(coins), fee: toWire(fee), items, shareBps };
        this.unlock(m); // pets stay locked until the spoils are settled
        this.push(m);
        await Promise.all([this.game.refreshBalance(W), this.game.refreshBalance(L)]).catch(() => {});
        const got = [coins > 0n ? `${formatTokens(coins)} coins` : "", RESOURCES.some((r) => items[r]) ? describeInv(items) : ""].filter(Boolean).join(" + ");
        this.game.toastOwner(W, "good", got ? `${W.name} won Bubble Roulette and took ${got}!` : `${W.name} won Bubble Roulette!`);
        this.game.toastOwner(L, "bad", got ? `${L.name} got soaked — ${W.name} took ${got}` : `${L.name} got soaked — good game!`);
      });
    void emptyInventory;
  }

  /**
   * A demo rival (or the tutorial's Coach Kiki) challenges a player's pet:
   * the match starts right away and the bot plays its own turns.
   */
  startBot(p: PetRt, bot: BotInfo): boolean {
    const now = this.game.now();
    if (p.matchId || p.busy || p.s.status === "knocked_out") return false;
    if (!this.online(p.ownerId)) return false;
    if (!bot.practice && this.eligible(p, now)) return false;
    const epoch = this.game.epochNow();
    if (!epoch) return false;
    const fake = makeBotPet(bot);
    const id = newId("br");
    const playerHp = bot.practice ? 100 : Math.max(BUBBLE.minHp, toBattleHp(p.s.hp, p.stats.maxHp));
    const m: Match = {
      id, state: "active", pets: { a: p, b: fake }, hp: { a: playerHp, b: 100 }, startHp: { a: playerHp, b: 100 },
      turn: "a", turnNo: 1, turnEndsAt: now + BUBBLE.turnMs + BUBBLE.firstTurnGraceMs, chamberNo: 0, chamber: makeChamber(epoch.seed, id, 0), pos: 0,
      missed: { a: 0, b: 0 }, last: null, winner: null, reason: "", epoch: { id: epoch.id, seed: epoch.seed, commitment: epoch.commitment },
      inviteExpiresAt: now, log: [], settled: false, doneAt: 0, actionsLeft: 1, bot: { banditId: bot.banditId, practice: bot.practice, side: "b", actAt: 0 },
    };
    this.matches.set(id, m);
    p.matchId = id; p.busy = true; p.path = []; p.moveDir = null; p.task = null; p.round = null; p.activity = `Bubble Roulette vs ${bot.name}`;
    if (!bot.practice) {
      p.s.energy = Math.max(0, p.s.energy - ECONOMY.battle.matchEnergy);
      p.s.hunger = Math.min(ECONOMY.stats.hungerMax, p.s.hunger + ECONOMY.battle.matchHunger);
    }
    p.dirty = true; p.metaDirty = true;
    this.push(m);
    return true;
  }

  /** A demo rival walks up and challenges a player's pet: an invite the owner can accept or decline. */
  inviteBot(p: PetRt, bot: BotInfo): boolean {
    const now = this.game.now();
    if (this.eligible(p, now) || !this.online(p.ownerId)) return false;
    const epoch = this.game.epochNow();
    if (!epoch) return false;
    const fake = makeBotPet(bot);
    const id = newId("br");
    const m: Match = {
      id, state: "invited", pets: { a: fake, b: p }, hp: { a: 100, b: toBattleHp(p.s.hp, p.stats.maxHp) },
      startHp: { a: 100, b: toBattleHp(p.s.hp, p.stats.maxHp) }, turn: "b", turnNo: 0, turnEndsAt: 0, chamberNo: 0, chamber: [], pos: 0, missed: { a: 0, b: 0 },
      last: null, winner: null, reason: "Waiting for you to accept", epoch: { id: epoch.id, seed: epoch.seed, commitment: epoch.commitment },
      inviteExpiresAt: now + BUBBLE.inviteMs, log: [], settled: false, doneAt: 0, actionsLeft: 1, bot: { banditId: bot.banditId, practice: false, side: "a", actAt: 0 },
    };
    this.matches.set(id, m);
    p.matchId = id; fake.matchId = id;
    this.sendInvite(m);
    return true;
  }

  /** Test/inspection helper. */
  get(id: string) { return this.matches.get(id); }
}

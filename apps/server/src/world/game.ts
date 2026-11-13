/**
 * Authoritative world simulation. Clients only send intents; positions,
 * gathering, trades, needs and battles are all computed here. Any action with
 * a financial consequence commits a DB transaction (ledger + state) before
 * the in-memory world is updated.
 */
import {
  computeTheft, DEFAULT_STRATEGY, demandLevel, ECONOMY, emptyInventory, findPath, gatherDurationMs,
  generateWorld, initialDemand, inventoryWeight, merchantPrice, RESOURCES, simulateBattle, standSpot,
  tileCenter, toTile, toWire, treasuryFactorBps, updateDemand, walkable, encodeTiles, WORLD_SEED,
  type DemandState, type Inventory, type MarketTicker, type MerchantDetail, type OwnPet, type PetPos,
  type PublicPet, type Resource, type ServerMsg, type Strategy, type WorldDef, type ClientMsg, type BattleEvent,
} from "@catchami/shared";
import type { Db } from "../db/index.ts";
import { acct, balanceOf, bigintJson, LedgerError, post, transfer } from "../ledger/ledger.ts";
import { consumeHqStock, dayKey, feePostings, grantMerchant, hqStock } from "../ledger/treasury.ts";
import { currentEpoch } from "../fairness.ts";
import { newId } from "../auth.ts";
import { decide } from "./ai.ts";
import { BubbleArena } from "./bubble.ts";
import { Bandits } from "./bandits.ts";
import { epochIdAt, type Epoch } from "../fairness.ts";
import { areaAt, battlesAllowed, carryCapacity, nodeStock, RESOURCE_LABEL, gradeRound, makeRound, MINIGAMES } from "@catchami/shared";
import { freshPetState, MERCHANT_DEFS, recomputeStats, type MerchantRt, type NodeRt, type PetRt, type PetState } from "./types.ts";

export interface GameClient {
  userId: string;
  displayName: string;
  controlled: string | null;
  send(msg: ServerMsg): void;
  lastMeta: number;
}

export class GameError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export interface Flags { pauseCatches: boolean; pauseTrades: boolean; pauseBattles: boolean; pauseWithdrawals: boolean }

const SPEED_SCALE = 1.7; // px/s per speed point (≈170 px/s ≈ 5 tiles/s for an average pet)
const GATHER_RANGE = 1.7 * ECONOMY.world.tileSize;

export class Game {
  world: WorldDef;
  pets = new Map<string, PetRt>();
  merchants: MerchantRt[] = [];
  nodes = new Map<string, NodeRt>();
  clients = new Set<GameClient>();
  demand: DemandState = initialDemand(Date.now());
  pendingConsume: Inventory = emptyInventory();
  pendingSupply: Inventory = emptyInventory();
  hqStockCache: Inventory = emptyInventory();
  treasuryFactor = 10_000;
  flags: Flags = { pauseCatches: false, pauseTrades: false, pauseBattles: false, pauseWithdrawals: false };
  tick = 0;
  private timer: NodeJS.Timeout | null = null;
  private last = Date.now();
  private lastFlush = 0;
  private lastDemand = 0;
  private lastSlow = 0;
  now = () => Date.now();
  arena = new BubbleArena(this);
  bandits!: Bandits;
  private epoch: Epoch | null = null;
  /** Fair-RNG epoch for synchronous rolls (refreshed in the background each hour). */
  epochNow(): Epoch | null {
    const now = this.now();
    if (!this.epoch || this.epoch.id !== epochIdAt(now)) void currentEpoch(this.db, now).then((e) => { this.epoch = e; }).catch(() => {});
    return this.epoch && this.epoch.id === epochIdAt(now) ? this.epoch : null;
  }

  db: Db;
  constructor(db: Db, world?: WorldDef) {
    this.db = db;
    this.world = world ?? generateWorld(WORLD_SEED);
    this.bandits = new Bandits(this);
    for (const n of this.world.nodes) {
      this.nodes.set(n.id, { ...n, remaining: nodeStock(n.id), nextRegen: 0 });
    }
  }

  // ------------------------------------------------------------ lifecycle --

  async load() {
    const now = this.now();
    const kv = await this.db.query<{ k: string; v: unknown }>(`SELECT k, v FROM kv WHERE k IN ('demand','flags')`);
    for (const row of kv.rows) {
      if (row.k === "demand") this.demand = row.v as DemandState;
      if (row.k === "flags") this.flags = { ...this.flags, ...(row.v as Flags) };
    }
    const hq = this.hq();
    for (const def of MERCHANT_DEFS) {
      const r = await this.db.query<{ state: Partial<MerchantRt> & { inventory: Inventory } }>(`SELECT state FROM merchants WHERE id = $1`, [def.id]);
      const saved = r.rows[0]?.state;
      await this.db.query(`INSERT INTO accounts (id, kind) VALUES ($1,'merchant') ON CONFLICT DO NOTHING`, [`merchant:${def.id}`]);
      const cash = (await this.db.tx((tx) => balanceOf(tx, acct.merchant(def.id)))).balance;
      const m: MerchantRt = {
        ...def, legIdx: 0, path: [], x: hq.x, y: hq.y, state: "at_hq", waitUntil: now + 2000,
        ...(def.stationary ? (() => { const q = this.world.pois.find((z) => z.id === def.route[0])!; return { x: tileCenter(q.tx), y: tileCenter(q.ty) }; })() : {}),
        cash, inventory: saved?.inventory ?? emptyInventory(), tripNo: Number(saved?.tripNo ?? 0), busy: Promise.resolve(),
      };
      if (!saved) await this.db.query(`INSERT INTO merchants (id, name, state) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [def.id, def.name, JSON.stringify(this.merchantState(m))]);
      this.merchants.push(m);
    }
    const rows = await this.db.query<PetRow>(PET_SELECT);
    for (const row of rows.rows) this.hydrate(row, now);
    await this.refreshTreasury();
    this.epoch = await currentEpoch(this.db, this.now());
  }

  start() {
    this.last = this.now();
    this.timer = setInterval(() => this.step(), 1000 / ECONOMY.world.tickHz);
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.flush(true);
  }

  hq() { return { x: tileCenter(this.world.hq.tx), y: tileCenter(this.world.hq.ty + 2) }; }

  /** A random free spot around the village plaza, so arriving pets don't pile up on one tile. */
  spawnSpot(): { x: number; y: number } {
    const h = this.world.hq;
    for (let i = 0; i < 60; i++) {
      const tx = h.tx + Math.floor(Math.random() * 21) - 10, ty = h.ty + 4 + Math.floor(Math.random() * 14);
      if (walkable(this.world, tx, ty)) return { x: tileCenter(tx), y: tileCenter(ty) };
    }
    return this.hq();
  }

  hydrate(row: PetRow, now = this.now()): PetRt {
    const genome = row.genome;
    const equipment = (row.equipment ?? []).filter((e) => e.equipped).map((e) => ({ id: e.id, kind: e.kind, rarity: e.rarity }));
    const stats = recomputeStats({ genome, equipment });
    const s: PetState = { ...freshPetState(this.hq().x, this.hq().y, stats), ...row.state };
    s.strategy = { ...DEFAULT_STRATEGY, ...s.strategy };
    // Offline catch-up for needs while the server was down (capped at 24h).
    const gap = Math.min(24 * 3600, Math.max(0, (now - new Date(row.updated_at).getTime()) / 1000));
    s.hunger = Math.min(ECONOMY.stats.hungerMax, s.hunger + gap * ECONOMY.stats.hungerPerSec);
    if (s.worldSeed !== WORLD_SEED || !walkable(this.world, toTile(s.x), toTile(s.y))) { const sp = this.spawnSpot(); s.x = sp.x; s.y = sp.y; }
    s.worldSeed = WORLD_SEED;
    const p: PetRt = {
      id: row.id, ownerId: row.owner_id, ownerName: row.display_name, name: row.name, species: row.species, rarity: row.rarity,
      genome, sticker: row.sticker, nftTokenId: row.nft_token_id, mintStatus: row.mint_status, createdAt: new Date(row.created_at).getTime(),
      equipment, stats, s,
      path: [], moveDir: null, facing: 1, anim: "idle", animUntil: 0, task: null, busy: false, manualUntil: 0,
      nextThink: now + Math.random() * 2000, balance: BigInt(row.balance ?? "0"), held: BigInt(row.held ?? "0"),
      listed: Boolean(row.listed), activity: "Waking up", dirty: false, metaDirty: true,
      round: null, nextRoundAt: 0, missedRounds: 0, matchId: null,
    };
    this.pets.set(p.id, p);
    return p;
  }

  async reloadPet(id: string) {
    const r = await this.db.query<PetRow>(`${PET_SELECT} WHERE p.id = $1`, [id]);
    const existing = this.pets.get(id);
    if (!r.rows[0]) { this.pets.delete(id); return null; }
    if (existing) {
      // Keep live position/needs, refresh ownership, equipment and balances.
      const row = r.rows[0];
      existing.ownerId = row.owner_id;
      existing.ownerName = row.display_name;
      existing.equipment = (row.equipment ?? []).filter((e) => e.equipped).map((e) => ({ id: e.id, kind: e.kind, rarity: e.rarity }));
      existing.stats = recomputeStats(existing);
      existing.balance = BigInt(row.balance ?? "0");
      existing.held = BigInt(row.held ?? "0");
      existing.listed = Boolean(row.listed);
      existing.mintStatus = row.mint_status;
      existing.nftTokenId = row.nft_token_id;
      existing.metaDirty = true;
      return existing;
    }
    return this.hydrate(r.rows[0]);
  }

  async refreshBalance(p: PetRt) {
    const b = await this.db.tx((tx) => balanceOf(tx, acct.pet(p.id)));
    p.balance = b.balance;
    p.held = b.held;
    p.metaDirty = true;
  }

  async refreshTreasury() {
    const hq = await this.db.tx((tx) => balanceOf(tx, acct.hq));
    this.treasuryFactor = treasuryFactorBps(hq.available);
    this.hqStockCache = await this.db.tx((tx) => hqStock(tx));
  }

  // ----------------------------------------------------------------- loop --

  step() {
    const now = this.now();
    const dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    this.tick++;
    for (const p of this.pets.values()) this.stepPet(p, dt, now);
    for (const m of this.merchants) this.stepMerchant(m, dt, now);
    if (!this.flags.pauseBattles) this.bandits.step(dt, now);
    for (const n of this.nodes.values()) {
      const cap = nodeStock(n.id);
      if (n.id.startsWith("glade-")) { if (n.remaining < cap && n.nextRegen && now >= n.nextRegen) { n.remaining = cap; n.nextRegen = 0; } continue; }
      if (n.remaining < cap && now >= n.nextRegen) {
        if (n.nextRegen !== 0) n.remaining = Math.min(cap, n.remaining + ECONOMY.gather.unitsPerHit);
        n.nextRegen = now + ECONOMY.resources[n.resource].regenMs;
      }
    }
    this.arena.tick(now);
    this.broadcast(now);
    if (now - this.lastFlush > 10_000) { this.lastFlush = now; void this.flush(); }
    if (now - this.lastDemand > ECONOMY.demand.recomputeSec * 1000) { this.lastDemand = now; void this.recomputeDemand(now); }
    if (now - this.lastSlow > 30_000) { this.lastSlow = now; void this.refreshTreasury().catch(() => {}); }
  }

  private stepPet(p: PetRt, dt: number, now: number) {
    const s = p.s;
    const cfg = ECONOMY.stats;
    // Needs.
    s.hunger = Math.min(cfg.hungerMax, s.hunger + cfg.hungerPerSec * dt);
    if (s.hunger >= cfg.hungerMax) s.energy = Math.max(0, s.energy - cfg.starvingEnergyDrainPerSec * dt);
    if (p.task?.kind === "rest") {
      if (s.hunger < cfg.restMaxHunger) s.energy = Math.min(p.stats.maxEnergy, s.energy + cfg.restEnergyPerSec * dt);
      if (s.energy >= p.stats.maxEnergy * 0.9 || s.hunger >= cfg.restMaxHunger) this.setTask(p, null);
    }
    // Status transitions.
    if (s.status === "knocked_out") {
      // stays knocked out until medicine
    } else if (s.energy <= 0 && s.hunger >= cfg.hungerMax) {
      if (s.status !== "inactive") { s.status = "inactive"; p.activity = "Out of energy and starving"; p.metaDirty = true; p.path = []; p.task = null; }
    } else if (s.status === "inactive" && s.energy > 0) {
      s.status = "active"; p.metaDirty = true;
    } else {
      s.status = p.task?.kind === "rest" ? "sleeping" : "active";
    }
    const ko = s.status === "knocked_out";
    if (ko && p.task?.kind === "gather") { p.task = null; p.round = null; }

    // Movement (a pet at 0 HP limps along slowly).
    const exhausted = s.energy < cfg.exhaustedEnergy;
    const speed = p.stats.speed * SPEED_SCALE * (s.status === "inactive" ? 0.45 : ko ? 0.55 : exhausted ? 0.6 : 1) * (s.hunger >= cfg.hungerMax ? 0.85 : 1);
    let moved = false;
    if (p.moveDir && now < p.moveDir.until && !p.busy) {
      const { dx, dy } = p.moveDir;
      moved = this.tryMove(p, dx * speed * dt, dy * speed * dt);
      if (moved) { p.task = null; p.path = []; }
    } else if (p.path.length && !p.busy) {
      const [tx, ty] = p.path[0]!;
      const gx = tileCenter(tx), gy = tileCenter(ty);
      const ddx = gx - s.x, ddy = gy - s.y;
      const d = Math.hypot(ddx, ddy);
      const stepLen = speed * dt;
      if (d <= stepLen) { s.x = gx; s.y = gy; p.path.shift(); } else { s.x += (ddx / d) * stepLen; s.y += (ddy / d) * stepLen; }
      if (Math.abs(ddx) > 1) p.facing = ddx > 0 ? 1 : -1;
      moved = true;
    }
    if (moved) {
      s.energy = Math.max(0, s.energy - cfg.walkEnergyPerSec * dt);
      p.dirty = true;
    }

    // Tasks.
    if (!p.busy && !moved && p.task?.kind === "gather") this.stepGather(p, now);
    if (!p.busy && !moved && !p.path.length && p.task?.kind === "sell") {
      const merchantId = p.task.merchantId;
      const m = this.merchants.find((x) => x.id === merchantId);
      if (m && Math.hypot(m.x - s.x, m.y - s.y) <= ECONOMY.merchants.interactRangePx && m.state !== "at_hq" && m.state !== "unavailable") {
        const items = { ...s.inventory };
        for (const r of s.strategy.hold) items[r] = 0;
        items.fish = Math.max(0, items.fish - s.strategy.foodReserve);
        p.task = null;
        void this.sell(p, m.id, items).catch((e: Error) => { p.activity = e.message; });
      } else if (m && m.state !== "at_hq" && m.state !== "unavailable") {
        // Merchant moved: re-path toward it (throttled by AI think interval).
        if (now >= p.nextThink) { this.pathTo(p, toTile(m.x), toTile(m.y)); p.nextThink = now + 1500; }
      } else {
        p.task = null;
      }
    }

    // Animation state.
    if (now >= p.animUntil) {
      p.anim = p.task?.kind === "rest" ? "sleep" : p.task?.kind === "gather" && p.task.endsAt ? "gather" : moved ? "walk" : ko ? "ko" : "idle";
    } else if (moved && (p.anim === "idle" || p.anim === "walk")) {
      p.anim = "walk";
    }

    // Autopilot.
    if (!p.busy && s.strategy.auto && now >= p.manualUntil && now >= p.nextThink) {
      p.nextThink = now + 1200 + Math.floor(Math.random() * 600);
      if (!p.path.length && !p.task) decide(this, p, now);
      else if (p.task?.kind === "gather" || p.task?.kind === "rest") decide(this, p, now, true);
    }
  }

  private tryMove(p: PetRt, mx: number, my: number): boolean {
    const s = p.s;
    const r = 9;
    const ok = (x: number, y: number) =>
      walkable(this.world, toTile(x - r), toTile(y - r)) && walkable(this.world, toTile(x + r), toTile(y - r)) &&
      walkable(this.world, toTile(x - r), toTile(y + r)) && walkable(this.world, toTile(x + r), toTile(y + r));
    let moved = false;
    if (mx && ok(s.x + mx, s.y)) { s.x += mx; moved = true; }
    if (my && ok(s.x, s.y + my)) { s.y += my; moved = true; }
    if (Math.abs(mx) > 0.01) p.facing = mx > 0 ? 1 : -1;
    return moved;
  }

  private stepGather(p: PetRt, now: number) {
    const t = p.task;
    if (t?.kind !== "gather") return;
    const node = this.nodes.get(t.nodeId);
    const s = p.s;
    if (!node) { p.task = null; return; }
    const nx = tileCenter(node.tx), ny = tileCenter(node.ty);
    if (Math.hypot(nx - s.x, ny - s.y) > GATHER_RANGE) {
      if (!p.path.length) {
        const spot = standSpot(this.world, node.tx, node.ty, toTile(s.x), toTile(s.y));
        if (!spot || !this.pathTo(p, spot[0], spot[1])) { p.task = null; p.activity = "Can't reach that spot"; }
      }
      return;
    }
    p.facing = nx >= s.x ? 1 : -1;
    const w = ECONOMY.resources[node.resource].weight;
    const stop = (why: string) => {
      p.task = null; p.activity = why; p.anim = "idle";
      if (t.minigame) { p.round = null; this.toOwner(p, { t: "mg_end", petId: p.id, reason: why }); }
    };
    if (s.status === "knocked_out") return stop(`${p.name} has 0 HP — buy medicine from a merchant to recover first`);
    if (s.energy < ECONOMY.stats.exhaustedEnergy) return stop("Too tired to gather");
    if (inventoryWeight(s.inventory) + w > carryCapacity(p.stats)) return stop("Bag is full");
    if (node.remaining <= 0) return stop("This spot is picked clean — it regrows soon");
    if (t.minigame) return this.stepMinigame(p, node, now, stop);
    if (t.endsAt === null) {
      t.endsAt = now + gatherDurationMs(p.species, p.genome.traits, p.stats.gather, node.resource);
      p.activity = `Gathering ${RESOURCE_LABEL[node.resource].toLowerCase()}`;
      return;
    }
    if (now < t.endsAt) return;
    // "Earn more": every hit yields a batch of units (bounded by the spot and the bag).
    const units = Math.max(1, Math.min(ECONOMY.gather.unitsPerHit, node.remaining, Math.floor((carryCapacity(p.stats) - inventoryWeight(s.inventory)) / w)));
    node.remaining -= units;
    if (node.nextRegen === 0 || node.nextRegen < now) node.nextRegen = now + ECONOMY.resources[node.resource].regenMs;
    s.inventory[node.resource] += units;
    s.energy = Math.max(0, s.energy - ECONOMY.resources[node.resource].energy * units);
    s.hunger = Math.min(ECONOMY.stats.hungerMax, s.hunger + ECONOMY.resources[node.resource].hunger * units);
    const today = dayKey(now);
    if (s.gatherDay !== today) { s.gatherDay = today; s.gatheredToday = 0; }
    s.gatheredToday += units;
    s.gatheredTotal += units;
    p.dirty = true;
    p.metaDirty = true;
    t.endsAt = null;
    if (!t.repeat) p.task = null;
  }

  // ------------------------------------------------------------ minigames --

  toOwner(p: PetRt, msg: ServerMsg) {
    for (const c of this.clients) if (c.userId === p.ownerId) c.send(msg);
  }

  /** Manual gathering: open a round, wait for the player's input, expire if ignored. */
  private stepMinigame(p: PetRt, node: NodeRt, now: number, stop: (why: string) => void) {
    if (p.round) {
      if (now - p.round.sentAt > MINIGAMES.timeoutMs + MINIGAMES.slackMs) {
        p.round = null;
        p.missedRounds++;
        if (p.missedRounds >= 2) return stop("Gathering paused — tap the spot to start again");
        p.nextRoundAt = now + 600;
      }
      return;
    }
    if (now < p.nextRoundAt) return;
    const epoch = this.epochNow();
    if (!epoch) return; // fair seed loading; try next tick
    const id = newId("mg");
    const params = makeRound(epoch.seed, id, node.resource);
    p.round = { id, params, nodeId: node.id, sentAt: now };
    p.anim = "gather"; p.animUntil = now + 400;
    p.activity = `Gathering ${RESOURCE_LABEL[node.resource].toLowerCase()}`;
    this.toOwner(p, { t: "mg_round", round: { id, petId: p.id, nodeId: node.id, resource: node.resource, params, expiresInMs: MINIGAMES.timeoutMs } });
  }

  /** Grade a minigame input. The client only reports timing; yield is computed and capped here. */
  minigameInput(userId: string, roundId: string, ms: number) {
    const now = this.now();
    const p = [...this.pets.values()].find((x) => x.round?.id === roundId);
    if (!p || p.ownerId !== userId) throw new GameError("round", "That gathering round is over");
    const round = p.round!;
    const elapsed = now - round.sentAt;
    p.round = null; // single use: replays and double taps find nothing
    if (!Number.isFinite(ms) || ms < MINIGAMES.minReactionMs || ms > elapsed + MINIGAMES.slackMs || elapsed > MINIGAMES.timeoutMs + MINIGAMES.slackMs) {
      p.nextRoundAt = now + 700;
      throw new GameError("timing", "That swing didn't count — try again");
    }
    const node = this.nodes.get(round.nodeId);
    if (!node || p.task?.kind !== "gather" || p.task.nodeId !== node.id) throw new GameError("round", "Not gathering here anymore");
    if (Math.hypot(tileCenter(node.tx) - p.s.x, tileCenter(node.ty) - p.s.y) > GATHER_RANGE) throw new GameError("too_far", "Too far from the spot");
    if (p.s.status === "knocked_out") throw new GameError("ko", `${p.name} has 0 HP — buy medicine from a merchant to recover first`);
    if (p.s.energy < ECONOMY.stats.exhaustedEnergy) throw new GameError("tired", "Too tired to gather");
    const { grade, detail } = gradeRound(round.params, ms);
    const w = ECONOMY.resources[node.resource].weight;
    const room = Math.floor((carryCapacity(p.stats) - inventoryWeight(p.s.inventory)) / w);
    const gained = Math.max(0, Math.min(MINIGAMES.yield[grade], node.remaining, room));
    p.s.energy = Math.max(0, p.s.energy - MINIGAMES.energyPerAttempt);
    if (gained > 0) {
      node.remaining -= gained;
      if (node.id.startsWith("glade-") && node.remaining <= 0) node.nextRegen = now + 15_000;
      if (node.nextRegen === 0 || node.nextRegen < now) node.nextRegen = now + ECONOMY.resources[node.resource].regenMs;
      p.s.inventory[node.resource] += gained;
      p.s.energy = Math.max(0, p.s.energy - ECONOMY.resources[node.resource].energy * gained);
      p.s.hunger = Math.min(ECONOMY.stats.hungerMax, p.s.hunger + ECONOMY.resources[node.resource].hunger * gained);
      const today = dayKey(now);
      if (p.s.gatherDay !== today) { p.s.gatherDay = today; p.s.gatheredToday = 0; }
      p.s.gatheredToday += gained;
      p.s.gatheredTotal += gained;
    }
    p.missedRounds = 0;
    p.dirty = true; p.metaDirty = true;
    p.anim = "gather"; p.animUntil = now + 700;
    p.nextRoundAt = now + 900;
    const note = gained < MINIGAMES.yield[grade] ? (room < MINIGAMES.yield[grade] ? "bag full" : "spot running low") : undefined;
    this.toOwner(p, { t: "mg_result", roundId, petId: p.id, nodeId: node.id, resource: node.resource, grade, gained, detail, note });
    void this.db.query(`INSERT INTO resource_events (kind, resource, qty, ref) VALUES ('gathered', $1, $2, $3)`, [node.resource, gained, `${roundId}:${grade}`]).catch(() => {});
  }

  private stepMerchant(m: MerchantRt, dt: number, now: number) {
    if (m.stationary) return this.stepStationary(m, now);
    if (now < m.waitUntil) return;
    if (m.state === "at_hq" || m.state === "unavailable") {
      m.waitUntil = now + 60_000; // guard against re-entry while the grant is in flight
      void this.merchantAtHq(m, now);
      return;
    }
    if (!m.path.length) {
      // Reached a leg's POI.
      if (m.state === "returning" || m.legIdx >= m.route.length - 1) {
        m.state = "at_hq";
        m.waitUntil = now + ECONOMY.merchants.restAtHqMs;
        return;
      }
      m.legIdx++;
      const poi = this.world.pois.find((q) => q.id === m.route[m.legIdx])!;
      m.path = findPath(this.world, toTile(m.x), toTile(m.y), poi.tx, poi.ty, 120_000) ?? [];
      m.waitUntil = now + 18_000; // set up shop at each stop
      return;
    }
    const [tx, ty] = m.path[0]!;
    const gx = tileCenter(tx), gy = tileCenter(ty);
    const d = Math.hypot(gx - m.x, gy - m.y);
    const st = ECONOMY.merchants.speedPxPerSec * dt;
    if (d <= st) { m.x = gx; m.y = gy; m.path.shift(); } else { m.x += ((gx - m.x) / d) * st; m.y += ((gy - m.y) / d) * st; }
    const capLeft = ECONOMY.merchants.inventoryCapacity - inventoryWeight(m.inventory);
    const lowCash = m.cash * 10_000n < ECONOMY.merchants.tripMinBudget * BigInt(ECONOMY.merchants.lowFundsBps);
    if (m.state === "travelling" && (capLeft < 4 || lowCash)) this.sendMerchantHome(m);
  }

  /** The Keeper's stall in the tutorial glade: never travels; delivers and refills in place. */
  private stepStationary(m: MerchantRt, now: number) {
    if (now < m.waitUntil) return;
    const capLeft = ECONOMY.merchants.inventoryCapacity - inventoryWeight(m.inventory);
    const lowCash = m.cash * 10_000n < ECONOMY.merchants.tripMinBudget * BigInt(ECONOMY.merchants.lowFundsBps);
    if (m.state === "travelling" && !lowCash && capLeft > 400) return;
    m.waitUntil = now + 60_000;
    void this.merchantAtHq(m, now).then(() => {
      const poi = this.world.pois.find((q) => q.id === m.route[0]);
      if (poi) { m.x = tileCenter(poi.tx); m.y = tileCenter(poi.ty); }
      m.path = [];
      if (m.state === "travelling") m.waitUntil = now + 5_000;
    });
  }

  /** Tutorial: move the player's pet into the Keeper's Glade, or out to Paw Village. */
  tutorialMove(userId: string, petId: string, where: "enter" | "exit", stage?: number) {
    const p = this.pets.get(petId);
    if (!p || p.ownerId !== userId) throw new GameError("not_owner", "Not your pet");
    if (where === "exit") {
      const sp = this.spawnSpot(); p.s.x = sp.x; p.s.y = sp.y;
      // Leaving the tutorial (finished or skipped) never strands a pet hungry or at 0 HP.
      if (p.s.status === "knocked_out" || p.s.hp <= 0) { p.s.hp = Math.round(p.stats.maxHp * 0.4); p.s.status = "active"; p.s.koUntil = null; }
      p.s.hunger = Math.min(p.s.hunger, 500);
    }
    else {
      const id = stage && stage >= 1 && stage <= 8 ? `glade_s${stage}` : "glade_spawn";
      // Scenes that set the pet up for the lesson.
      if (stage === 4) { p.s.hunger = ECONOMY.stats.hungerMax; p.s.energy = Math.max(p.s.energy, 500); if (p.s.status === "inactive") p.s.status = "active"; } // Hungry: empty food bar
      if (stage === 5) { p.s.hp = 0; p.s.status = "knocked_out"; p.s.koUntil = null; p.task = null; p.round = null; } // Hurt: 0 HP
      if (stage === 6) this.bandits.resetPractice(p.id);
      const poi = this.world.pois.find((q) => q.id === id) ?? this.world.pois.find((q) => q.id === "glade_spawn")!;
      p.s.x = tileCenter(poi.tx) + (Math.random() - 0.5) * 20; p.s.y = tileCenter(poi.ty) + Math.random() * 10;
    }
    p.path = []; p.moveDir = null; p.task = null; p.round = null;
    p.activity = where === "enter" ? "Training with the Keeper" : "Arrived in Paw Village";
    p.dirty = true; p.metaDirty = true;
    return { ok: true };
  }

  private sendMerchantHome(m: MerchantRt) {
    const hq = this.world.pois.find((q) => q.id === "hq")!;
    m.path = findPath(this.world, toTile(m.x), toTile(m.y), hq.tx, hq.ty, 120_000) ?? [];
    m.state = "returning";
  }

  async merchantAtHq(m: MerchantRt, now: number) {
    await (m.busy = m.busy.then(async () => {
      // 1. Deliver real collected resources to HQ inventory.
      if (inventoryWeight(m.inventory) > 0) {
        const inv = { ...m.inventory };
        await this.db.tx(async (tx) => {
          for (const r of RESOURCES) if (inv[r] > 0) {
            await tx.query(`UPDATE hq_inventory SET qty = qty + $1 WHERE resource = $2`, [inv[r], r]);
            await tx.query(`INSERT INTO resource_events (kind, resource, qty, ref) VALUES ('delivered', $1, $2, $3)`, [r, inv[r], `merchant:${m.id}:${m.tripNo}`]);
          }
          await tx.query(`UPDATE merchants SET state = $2 WHERE id = $1`, [m.id, JSON.stringify(this.merchantState({ ...m, inventory: emptyInventory() }))]);
        });
        m.inventory = emptyInventory();
        await this.refreshTreasury();
      }
      // 2. Ask HQ for the next trip budget (real transfer, capped).
      if (this.flags.pauseTrades) { m.state = "unavailable"; m.waitUntil = now + 60_000; return; }
      const g = await grantMerchant(this.db, m.id, m.tripNo + 1, now);
      m.cash = g.cash;
      if (!g.available) { m.state = "unavailable"; m.waitUntil = now + 60_000; return; }
      m.tripNo++;
      m.legIdx = 0;
      m.state = "travelling";
      m.path = [];
      m.waitUntil = now;
      await this.db.query(`UPDATE merchants SET state = $2 WHERE id = $1`, [m.id, JSON.stringify(this.merchantState(m))]);
    }).catch((e) => { console.error("merchant at hq", m.id, e); m.state = "unavailable"; m.waitUntil = now + 60_000; }));
  }

  merchantState(m: MerchantRt) { return { inventory: m.inventory, tripNo: m.tripNo }; }

  // -------------------------------------------------------------- pathing --

  pathTo(p: PetRt, tx: number, ty: number): boolean {
    const path = findPath(this.world, toTile(p.s.x), toTile(p.s.y), tx, ty);
    if (!path) return false;
    p.path = path;
    return true;
  }

  setTask(p: PetRt, t: PetRt["task"]) { p.task = t; }

  // ------------------------------------------------------- prices/market --

  priceFor(m: MerchantRt, r: Resource): bigint {
    const base = merchantPrice(r, this.demand[r].indexBps, this.treasuryFactor);
    return (base * BigInt(10_000 + (m.prefs[r] ?? 0))) / 10_000n;
  }

  merchantDetail(m: MerchantRt): MerchantDetail {
    return {
      id: m.id,
      cash: toWire(m.cash),
      inventory: { ...m.inventory },
      capacityLeft: ECONOMY.merchants.inventoryCapacity - inventoryWeight(m.inventory),
      prices: Object.fromEntries(RESOURCES.map((r) => [r, toWire(this.priceFor(m, r))])) as MerchantDetail["prices"],
    };
  }

  ticker(): MarketTicker {
    return {
      demand: Object.fromEntries(RESOURCES.map((r) => [r, { level: demandLevel(this.demand[r].indexBps), indexBps: this.demand[r].indexBps }])) as MarketTicker["demand"],
      hqStock: { ...this.hqStockCache },
      treasuryFactorBps: this.treasuryFactor,
    };
  }

  private async recomputeDemand(now: number) {
    const c = this.pendingConsume, sp = this.pendingSupply;
    this.pendingConsume = emptyInventory();
    this.pendingSupply = emptyInventory();
    for (const r of RESOURCES) this.demand[r] = updateDemand(this.demand[r], now, c[r], sp[r]);
    await this.db.query(`INSERT INTO kv (k, v) VALUES ('demand', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [JSON.stringify(this.demand)]);
  }

  async setFlags(f: Partial<Flags>, actor: string) {
    this.flags = { ...this.flags, ...f };
    await this.db.tx(async (tx) => {
      await tx.query(`INSERT INTO kv (k, v) VALUES ('flags', $1) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`, [JSON.stringify(this.flags)]);
      await tx.query(`INSERT INTO admin_log (actor, action, detail) VALUES ($1,'set_flags',$2)`, [actor, JSON.stringify(f)]);
    });
  }

  // ----------------------------------------------------------- financial --

  /** Run a financial op on a pet with an exclusive lock. */
  async withPet<R>(p: PetRt, fn: () => Promise<R>): Promise<R> {
    if (p.busy) throw new GameError("busy", `${p.name} is busy`);
    p.busy = true;
    try { return await fn(); } finally { p.busy = false; }
  }

  async sell(p: PetRt, merchantId: string, items: Partial<Inventory>): Promise<{ sold: Inventory; total: bigint }> {
    if (this.flags.pauseTrades) throw new GameError("paused", "Trading is paused by operations");
    const m = this.merchants.find((x) => x.id === merchantId);
    if (!m) throw new GameError("not_found", "No such merchant");
    if (m.state === "at_hq" || m.state === "unavailable") throw new GameError("closed", `${m.name} is not trading right now`);
    if (Math.hypot(m.x - p.s.x, m.y - p.s.y) > ECONOMY.merchants.interactRangePx) throw new GameError("too_far", `Walk closer to ${m.name}`);
    if (p.s.status === "inactive") throw new GameError("inactive", `${p.name} can't trade right now`);
    return this.withPet(p, () => (m.busy = m.busy.then(async (): Promise<{ sold: Inventory; total: bigint }> => {
      let capLeft = ECONOMY.merchants.inventoryCapacity - inventoryWeight(m.inventory);
      let cash = m.cash;
      const sold = emptyInventory();
      let total = 0n;
      // Sell the highest-value-per-weight first.
      const order = [...RESOURCES].sort((a, b) => Number(this.priceFor(m, b) / BigInt(ECONOMY.resources[b].weight) - this.priceFor(m, a) / BigInt(ECONOMY.resources[a].weight)));
      for (const r of order) {
        const want = Math.max(0, Math.min(Math.floor(items[r] ?? 0), p.s.inventory[r]));
        const price = this.priceFor(m, r);
        if (!want || price <= 0n) continue;
        const byCap = Math.floor(capLeft / ECONOMY.resources[r].weight);
        const byCash = Number(cash / price);
        const n = Math.min(want, byCap, byCash);
        if (n <= 0) continue;
        sold[r] = n;
        total += price * BigInt(n);
        cash -= price * BigInt(n);
        capLeft -= n * ECONOMY.resources[r].weight;
      }
      if (total === 0n) {
        throw new GameError("no_sale", capLeft < 4 ? `${m.name}'s cart is full` : cash < this.priceFor(m, "wood") ? `${m.name} is out of money` : "Nothing to sell");
      }
      const saleId = newId("sale");
      const petInv = { ...p.s.inventory };
      const merchInv = { ...m.inventory };
      for (const r of RESOURCES) { petInv[r] -= sold[r]; merchInv[r] += sold[r]; }
      const petState = { ...p.s, inventory: petInv };
      await this.db.tx(async (tx) => {
        await post(tx, { idem: saleId, kind: "sale", postings: transfer(acct.merchant(m.id), acct.pet(p.id), total), meta: { petId: p.id, merchantId: m.id, sold } });
        await tx.query(`UPDATE merchants SET state = $2 WHERE id = $1`, [m.id, JSON.stringify(this.merchantState({ ...m, inventory: merchInv }))]);
        await tx.query(`UPDATE pets SET state = $2, updated_at = now() WHERE id = $1`, [p.id, JSON.stringify(petState)]);
        for (const r of RESOURCES) if (sold[r]) await tx.query(`INSERT INTO resource_events (kind, resource, qty, ref) VALUES ('supply', $1, $2, $3)`, [r, sold[r], saleId]);
      });
      p.s.inventory = petInv;
      m.inventory = merchInv;
      m.cash = cash;
      p.balance += total;
      for (const r of RESOURCES) this.pendingSupply[r] += sold[r];
      p.anim = "trade"; p.animUntil = this.now() + 1200;
      p.activity = `Sold to ${m.name}`;
      p.metaDirty = true;
      this.toastOwner(p, "good", `${p.name} sold ${describeInv(sold)} to ${m.name}`);
      return { sold, total };
    })) as Promise<{ sold: Inventory; total: bigint }>);
  }

  async buy(p: PetRt, item: "food" | "medicine", rid = newId("buy")) {
    if (this.flags.pauseTrades) throw new GameError("paused", "Shops are paused by operations");
    const now = this.now();
    if (item === "food" && p.s.hunger < 50) throw new GameError("full", `${p.name} isn't hungry`);
    const inGlade = areaAt(this.world, p.s.x, p.s.y).id === "glade";
    // (The tutorial glade lets you practise buying medicine even when healthy.)
    if (item === "medicine" && !inGlade && p.s.status !== "knocked_out" && p.s.hp >= p.stats.maxHp) throw new GameError("healthy", `${p.name} is already healthy`);
    const cfg = item === "food" ? ECONOMY.food : ECONOMY.medicine;
    const resource: Resource = item === "food" ? "fish" : "herbs";
    const qty = item === "food" ? ECONOMY.food.fishPerMeal : ECONOMY.medicine.herbsPerDose;
    return this.withPet(p, async () => {
      const next = { ...p.s };
      if (item === "food") {
        next.hunger = Math.max(0, next.hunger - ECONOMY.food.hungerRestore);
        next.energy = Math.min(p.stats.maxEnergy, next.energy + ECONOMY.food.energyRestore);
      } else {
        next.hp = Math.min(p.stats.maxHp, next.hp + Math.floor((p.stats.maxHp * ECONOMY.medicine.healBps) / 10_000));
        if (next.status === "knocked_out") { next.status = "active"; next.koUntil = null; }
      }
      let price = cfg.price, local = true;
      try {
        await this.db.tx(async (tx) => {
          local = inGlade || (await consumeHqStock(tx, resource, qty, `${item}:${rid}`));
          // No local stock: imported at a premium (no HQ stock used).
          if (!local) price = (cfg.price * BigInt(cfg.importMultBps)) / 10_000n;
          await post(tx, { idem: `${item}:${rid}`, kind: item, postings: feePostings(acct.pet(p.id), price, cfg.split), meta: { petId: p.id, imported: !local } });
          await tx.query(`UPDATE pets SET state = $2, updated_at = now() WHERE id = $1`, [p.id, JSON.stringify(next)]);
        });
      } catch (e) {
        if (e instanceof LedgerError && e.code === "insufficient_funds") throw new GameError("insufficient_funds", `${p.name} can't afford ${item}`);
        throw e;
      }
      p.s.hunger = next.hunger; p.s.energy = next.energy; p.s.hp = next.hp; p.s.status = next.status; p.s.koUntil = next.koUntil;
      p.balance -= price;
      if (!inGlade) {
        // Imported meals still count as demand: an empty kitchen raises what merchants pay for fish/herbs.
        this.pendingConsume[resource] += qty;
        if (local) this.hqStockCache[resource] = Math.max(0, this.hqStockCache[resource] - qty);
      }
      p.anim = "eat"; p.animUntil = now + 1500;
      p.activity = item === "food" ? (local ? "Had a meal" : "Had an imported meal") : "Took medicine";
      p.metaDirty = true;
      return { price, imported: !local };
    });
  }

  // ------------------------------------------------------------- clients --

  toastOwner(p: PetRt, kind: "info" | "good" | "bad", text: string) {
    for (const c of this.clients) if (c.userId === p.ownerId) c.send({ t: "toast", kind, text, petId: p.id });
  }

  clientCenter(c: GameClient) {
    const p = c.controlled ? this.pets.get(c.controlled) : null;
    return p ? { x: p.s.x, y: p.s.y } : this.hq();
  }

  join(c: GameClient) {
    this.clients.add(c);
    const own = [...this.pets.values()].filter((p) => p.ownerId === c.userId);
    if (!c.controlled && own[0]) c.controlled = own[0].id;
    c.send({
      t: "welcome",
      userId: c.userId,
      displayName: c.displayName,
      network: "",
      map: { w: this.world.w, h: this.world.h, tiles: encodeTiles(this.world.tiles), seed: WORLD_SEED },
      nodes: this.world.nodes.map((n) => ({ id: n.id, resource: n.resource, tx: n.tx, ty: n.ty })),
      pois: this.world.pois,
      hq: this.world.hq,
      controlled: c.controlled,
    });
    c.lastMeta = 0;
    c.send({ t: "market", ticker: this.ticker() });
    this.arena.sync(c);
    this.arena.presence();
  }

  leave(c: GameClient) { this.clients.delete(c); this.arena.presence(); }

  async handle(c: GameClient, msg: ClientMsg): Promise<void> {
    const now = this.now();
    const own = (id: string) => {
      const p = this.pets.get(id);
      if (!p || p.ownerId !== c.userId) throw new GameError("not_owner", "That isn't your pet");
      return p;
    };
    const manual = (p: PetRt) => { p.manualUntil = now + 45_000; };
    switch (msg.t) {
      case "ping": c.send({ t: "pong", at: msg.at, serverTime: now }); return;
      case "select": own(msg.petId); c.controlled = msg.petId; c.lastMeta = 0; return;
      case "move": {
        if (!c.controlled) return;
        const p = own(c.controlled);
        const len = Math.hypot(msg.dx, msg.dy);
        if (!Number.isFinite(len)) return;
        if (len < 0.05) { p.moveDir = null; return; }
        const k = len > 1 ? 1 / len : 1;
        p.moveDir = { dx: msg.dx * k, dy: msg.dy * k, until: now + 350 };
        if (p.task?.kind === "rest") p.task = null;
        manual(p);
        return;
      }
      case "duel_input": { this.bandits.duelInput(c.userId, String(msg.duelId), Number(msg.hits)); return; }
      case "fight_bandit": {
        const p = own(msg.petId);
        this.bandits.challenge(p, msg.banditId, now);
        return;
      }
      case "tutorial": {
        own(msg.petId);
        this.tutorialMove(c.userId, msg.petId, msg.action === "exit" ? "exit" : "enter", msg.action === "stage" ? Number(msg.stage) : undefined);
        return;
      }
      case "goto": {
        if (!c.controlled) return;
        const p = own(c.controlled);
        const tx = toTile(msg.x), ty = toTile(msg.y);
        if (!this.pathTo(p, tx, ty)) throw new GameError("no_path", "Can't walk there");
        p.task = null;
        manual(p);
        return;
      }
      case "gather": {
        const p = own(msg.petId);
        const node = this.nodes.get(msg.nodeId);
        if (!node) throw new GameError("not_found", "No such resource spot");
        if (p.s.status === "knocked_out") throw new GameError("ko", `${p.name} has 0 HP — buy medicine from a merchant to recover first`);
        if (p.s.status !== "active" && p.s.status !== "sleeping") throw new GameError("inactive", `${p.name} can't gather right now`);
        if (p.matchId) throw new GameError("in_match", `${p.name} is in a Bubble Roulette match`);
        p.task = { kind: "gather", nodeId: node.id, endsAt: null, repeat: true, minigame: true };
        p.round = null; p.missedRounds = 0; p.nextRoundAt = 0;
        p.path = [];
        manual(p);
        return;
      }
      case "sell": { const p = own(msg.petId); manual(p); await this.sell(p, msg.merchantId, msg.items); return; }
      case "buy": { const p = own(msg.petId); await this.buy(p, msg.item, `${c.userId}:${msg.rid}`); return; }
      case "rest": { const p = own(msg.petId); p.task = { kind: "rest" }; p.path = []; manual(p); return; }
      case "challenge": {
        const p = own(msg.petId);
        const t = this.pets.get(msg.targetId);
        if (!t) throw new GameError("not_found", "That pet is gone");
        manual(p);
        this.arena.challenge(c, p, t); // the one battle game is Bubble Roulette
        return;
      }
      case "mg_input": { this.minigameInput(c.userId, msg.roundId, msg.ms); return; }
      case "mg_stop": { const p = own(msg.petId); if (p.task?.kind === "gather") { p.task = null; p.round = null; p.activity = "Stopped gathering"; } return; }
      case "br_challenge": { const p = own(msg.petId); const t = this.pets.get(msg.targetId); if (!t) throw new GameError("not_found", "That pet is gone"); manual(p); this.arena.challenge(c, p, t); return; }
      case "br_respond": { this.arena.respond(c, msg.matchId, msg.accept); return; }
      case "br_action": { this.arena.action(c, msg.matchId, msg.target, msg.turnNo); return; }
      case "br_forfeit": { this.arena.forfeit(c, msg.matchId); return; }
      case "br_sync": { this.arena.sync(c); return; }
      case "strategy": {
        const p = own(msg.petId);
        p.s.strategy = sanitizeStrategy(msg.strategy);
        p.dirty = true;
        if (p.s.strategy.auto) p.manualUntil = 0;
        return;
      }
    }
  }

  private broadcast(now: number) {
    if (!this.clients.size) return;
    const R = ECONOMY.world.viewRadiusPx;
    const m = this.merchants.map((x) => ({ id: x.id, name: x.name, x: Math.round(x.x), y: Math.round(x.y), state: x.state, hue: x.hue }));
    const b = this.bandits.snapshot();
    const sendMeta = this.tick % 10 === 0;
    const sendOwn = this.tick % 5 === 0;
    const sendMarket = this.tick % 50 === 0;
    const ticker = sendMarket ? this.ticker() : null;
    for (const c of this.clients) {
      const ctr = this.clientCenter(c);
      const near: PetRt[] = [];
      for (const p of this.pets.values()) if (Math.abs(p.s.x - ctr.x) < R && Math.abs(p.s.y - ctr.y) < R) near.push(p);
      const pos: PetPos[] = near.map((p) => [p.id, Math.round(p.s.x), Math.round(p.s.y), p.anim, p.facing]);
      c.send({ t: "snap", tick: this.tick, p: pos, m, b: b.filter((r) => Math.abs(r[1] - ctr.x) < R && Math.abs(r[2] - ctr.y) < R) });
      if (sendMeta || now - c.lastMeta > 1000) {
        c.lastMeta = now;
        const nodes = [...this.nodes.values()].filter((n) => Math.abs(tileCenter(n.tx) - ctr.x) < R && Math.abs(tileCenter(n.ty) - ctr.y) < R).map((n) => ({ id: n.id, remaining: n.remaining }));
        c.send({ t: "meta", pets: near.map((p) => this.publicView(p)), nodes });
        // Merchant details only within interaction range of the controlled pet.
        const cp = c.controlled ? this.pets.get(c.controlled) : null;
        if (cp) for (const mm of this.merchants) {
          const inRange = Math.hypot(mm.x - cp.s.x, mm.y - cp.s.y) <= ECONOMY.merchants.interactRangePx && mm.state !== "at_hq" && mm.state !== "unavailable";
          if (inRange) c.send({ t: "merchant", id: mm.id, detail: this.merchantDetail(mm) });
        }
      }
      if (sendOwn) {
        const mine = [...this.pets.values()].filter((p) => p.ownerId === c.userId);
        if (c.controlled && !mine.some((p) => p.id === c.controlled)) c.controlled = null; // sold or transferred
        if (!c.controlled && mine[0]) c.controlled = mine[0].id;
        c.send({ t: "own", pets: mine.map((p) => this.ownView(p, now)), wallet: { available: "" }, controlled: c.controlled });
      }
      if (ticker) c.send({ t: "market", ticker });
    }
  }

  publicView(p: PetRt): PublicPet {
    return {
      id: p.id, ownerId: p.ownerId, ownerName: p.ownerName, name: p.name, species: p.species, rarity: p.rarity, look: p.genome.look,
      sticker: p.sticker, status: p.s.status, balance: toWire(p.balance), carried: { ...p.s.inventory }, equipment: p.equipment.map((e) => e.kind),
    };
  }

  ownView(p: PetRt, now = this.now()): OwnPet {
    return {
      ...this.publicView(p),
      x: Math.round(p.s.x), y: Math.round(p.s.y),
      autopilotResumesAt: p.s.strategy.auto && p.manualUntil > now ? p.manualUntil : null,
      createdAt: p.createdAt,
      listed: p.listed,
      hp: Math.round(p.s.hp), energy: Math.round(p.s.energy), hunger: Math.round(p.s.hunger),
      stats: p.stats, baseStats: p.genome.stats, traits: p.genome.traits, strategy: p.s.strategy,
      available: toWire(p.balance - p.held), held: toWire(p.held), koUntil: p.s.koUntil, activity: p.activity,
      nftTokenId: p.nftTokenId, mintStatus: p.mintStatus, gatheredToday: p.s.gatherDay === dayKey(now) ? p.s.gatheredToday : 0,
      wins: p.s.wins, losses: p.s.losses,
    };
  }

  async flush(all = false) {
    const dirty = [...this.pets.values()].filter((p) => (all || p.dirty) && !p.busy);
    if (!dirty.length) return;
    for (const p of dirty) p.dirty = false;
    await this.db.query(
      `UPDATE pets p SET state = x.s::jsonb, updated_at = now() FROM (SELECT unnest($1::text[]) AS id, unnest($2::text[]) AS s) x WHERE p.id = x.id`,
      [dirty.map((p) => p.id), dirty.map((p) => JSON.stringify(p.s, bigintJson))],
    ).catch((e) => { console.error("flush failed", e); for (const p of dirty) p.dirty = true; });
  }
}

export function describeInv(inv: Partial<Inventory>): string {
  const parts = RESOURCES.filter((k) => (inv[k] ?? 0) > 0).map((k) => `${inv[k]} ${RESOURCE_LABEL[k].toLowerCase()}`);
  return parts.length ? parts.join(", ") : "nothing";
}

export function sanitizeStrategy(s: Partial<Strategy>): Strategy {
  const d = DEFAULT_STRATEGY;
  const pick = <T extends string>(v: unknown, opts: readonly T[], def: T): T => (opts.includes(v as T) ? (v as T) : def);
  const int = (v: unknown, lo: number, hi: number, def: number) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v as number))) : def);
  const amount = (v: unknown) => (typeof v === "string" && /^\d{1,40}$/.test(v) ? v : "0");
  return {
    auto: typeof s.auto === "boolean" ? s.auto : d.auto,
    work: pick(s.work, ["low", "balanced", "high"] as const, d.work),
    resource: pick(s.resource, ["fish", "herbs", "wood", "minerals", "demand"] as const, d.resource),
    sell: pick(s.sell, ["immediate", "full", "best_price", "nearest", "hold"] as const, d.sell),
    hold: Array.isArray(s.hold) ? s.hold.filter((x): x is Resource => (RESOURCES as readonly string[]).includes(x)) : [],
    battle: pick(s.battle, ["avoid", "defensive", "balanced", "aggressive"] as const, d.battle),
    minHpBps: int(s.minHpBps, 1_000, 10_000, d.minHpBps),
    maxCarryRiskBps: int(s.maxCarryRiskBps, 1_000, 10_000, d.maxCarryRiskBps),
    // Real-token wagering cannot be enabled through gameplay settings until the legal gate opens.
    realWager: false,
    maxWager: amount(s.maxWager),
    dailyWagerLoss: amount(s.dailyWagerLoss),
    foodReserve: int(s.foodReserve, 0, 20, d.foodReserve),
    eatAtHunger: int(s.eatAtHunger, 200, 950, d.eatAtHunger),
    buyMedicine: typeof s.buyMedicine === "boolean" ? s.buyMedicine : d.buyMedicine,
    restBelowEnergy: int(s.restBelowEnergy, 0, 600, d.restBelowEnergy),
  };
}

export interface PetRow {
  id: string; owner_id: string; display_name: string; species: PetRt["species"]; rarity: PetRt["rarity"]; name: string;
  genome: PetRt["genome"]; sticker: string | null; nft_token_id: string | null; mint_status: PetRt["mintStatus"];
  state: PetState; created_at: string; updated_at: string; balance: string | null; held: string | null; listed: boolean | null;
  equipment: Array<{ id: string; kind: PetRt["equipment"][number]["kind"]; rarity: PetRt["rarity"]; equipped: boolean }> | null;
}

export const PET_SELECT = `
  SELECT p.id, p.owner_id, u.display_name, p.species, p.rarity, p.name, p.genome, p.sticker, p.nft_token_id, p.mint_status,
         p.state, p.created_at::text, p.updated_at::text, a.balance::text AS balance, a.held::text AS held,
         EXISTS (SELECT 1 FROM listings l WHERE l.pet_id = p.id AND l.status = 'open') AS listed,
         (SELECT COALESCE(json_agg(json_build_object('id', e.id, 'kind', e.kind, 'rarity', e.rarity, 'equipped', e.equipped)), '[]'::json) FROM equipment e WHERE e.pet_id = p.id) AS equipment
  FROM pets p JOIN users u ON u.id = p.owner_id LEFT JOIN accounts a ON a.id = 'pet:' || p.id`;

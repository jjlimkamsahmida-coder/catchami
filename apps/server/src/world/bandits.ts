/**
 * Bandits: NPC thieves that roam the Forest and Mining Valley. When a player's
 * pet carrying resources comes close, a bandit gives chase; if it catches the
 * pet it snatches everything in the bag and runs off. Pets in Paw Village and
 * the Keeper's Glade are safe. Bandits are a little slower than pets, so a
 * watchful player can always dodge them.
 */
import { AREA_BOUNDS, areaAt, findPath, gladeArenaAt, inventoryWeight, RESOURCES, tileCenter, toTile, walkable, emptyInventory, Rng, type AreaId } from "@catchami/shared";
import type { Game } from "./game.ts";
import { GameError } from "./game.ts";
import type { PetRt } from "./types.ts";

export type BanditState = "wander" | "chase" | "flee" | "duel";
export interface BanditRt {
  id: string; name: string; home: AreaId; x: number; y: number; facing: 1 | -1;
  path: Array<[number, number]>; state: BanditState; target: string | null;
  nextThink: number; calmUntil: number;
  /** Tutorial training bandit: idle, never chases, never steals. */
  practice?: boolean; homeX?: number; homeY?: number;
}

const NAMES = ["Sneaky Sid", "Grabby Gus", "Pilfer Pip", "Swipey Sue", "Nabby Ned", "Loot Lou", "Snatch Sam", "Fidget Flo"];
const SPEED = { wander: 70, chase: 150, flee: 165 }; // px/s — pets walk ~170 px/s
const SIGHT = 230;      // px: notices loaded pets this close
const GIVE_UP = 460;    // px: stops chasing beyond this
const CATCH = 30;       // px: close enough to steal
const CALM_MS = 22_000; // after a theft, ignores pets for a while
const PER_AREA: Partial<Record<AreaId, number>> = { forest: 4, mines: 3 };
const DUEL_ROUNDS = 3;
const DUEL_MS = 14_000; // the player has this long to play the attack minigame
interface Duel { id: string; banditId: string; petId: string; ownerId: string; brave: boolean; deadline: number }

export class Bandits {
  list: BanditRt[] = [];
  private rng = Rng.fromString("catchami-bandits");
  private duels = new Map<string, Duel>();
  /** When each pet entered the training arena (the Training Bandit lets them settle in first). */
  private arrived = new Map<string, number>();
  private duelSeq = 0;

  private game: Game;
  constructor(game: Game) {
    this.game = game;
    let n = 0;
    for (const [area, count] of Object.entries(PER_AREA) as Array<[AreaId, number]>) {
      for (let i = 0; i < count; i++) {
        const [x, y] = this.randomSpot(area);
        this.list.push({ id: `bandit-${n}`, name: NAMES[n % NAMES.length]!, home: area, x, y, facing: 1, path: [], state: "wander", target: null, nextThink: 0, calmUntil: 0 });
        n++;
      }
    }
    const g = this.game.world.pois.find((p) => p.id === "glade_bandit");
    if (g) {
      const x = tileCenter(g.tx), y = tileCenter(g.ty);
      this.list.push({ id: "bandit-practice", name: "Training Bandit", home: "glade", x, y, facing: -1, path: [], state: "wander", target: null, nextThink: 0, calmUntil: 0, practice: true, homeX: x, homeY: y });
    }
  }

  private randomSpot(area: AreaId, near?: { x: number; y: number }, radius = 14): [number, number] {
    const [x0, y0, x1, y1] = AREA_BOUNDS[area];
    const w = this.game.world;
    for (let tries = 0; tries < 200; tries++) {
      const tx = near ? toTile(near.x) + this.rng.range(-radius, radius) : this.rng.range(x0 + 3, x1 - 4);
      const ty = near ? toTile(near.y) + this.rng.range(-radius, radius) : this.rng.range(y0 + 3, y1 - 4);
      if (tx <= x0 + 2 || tx >= x1 - 3 || ty <= y0 + 2 || ty >= y1 - 3) continue;
      if (walkable(w, tx, ty)) return [tileCenter(tx), tileCenter(ty)];
    }
    const poi = w.pois.find((p) => p.id === (area === "forest" ? "forest" : "mines"))!;
    return [tileCenter(poi.tx), tileCenter(poi.ty)];
  }

  private pathTo(b: BanditRt, x: number, y: number) {
    b.path = findPath(this.game.world, toTile(b.x), toTile(b.y), toTile(x), toTile(y), 8000) ?? [];
  }

  /** Pets worth robbing: active, carrying something, in this bandit's area. */
  private victimNear(b: BanditRt): PetRt | null {
    let best: PetRt | null = null, bd = SIGHT;
    for (const p of this.game.pets.values()) {
      if (p.s.status !== "active" || inventoryWeight(p.s.inventory) <= 0) continue;
      if (areaAt(this.game.world, p.s.x, p.s.y).id !== b.home) continue;
      const d = Math.hypot(p.s.x - b.x, p.s.y - b.y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  step(dt: number, now: number) {
    this.tickDuels(now);
    for (const b of this.list) {
      if (b.practice) { this.stepPractice(b, dt, now); continue; }
      if (b.state === "duel") continue; // frozen while the battle plays out
      // Think (choose targets / paths) a few times a second.
      if (now >= b.nextThink) {
        b.nextThink = now + (b.state === "chase" ? 450 : 900);
        const target = b.target ? this.game.pets.get(b.target) : null;
        if (b.state === "flee" && now >= b.calmUntil - CALM_MS + 4_000) { b.state = "wander"; b.path = []; }
        if (b.state === "chase") {
          const lost = !target || target.s.status !== "active" || inventoryWeight(target.s.inventory) <= 0
            || areaAt(this.game.world, target.s.x, target.s.y).id !== b.home || Math.hypot(target.s.x - b.x, target.s.y - b.y) > GIVE_UP;
          if (lost) { b.state = "wander"; b.target = null; b.path = []; }
          else this.pathTo(b, target!.s.x, target!.s.y);
        }
        if (b.state === "wander") {
          const v = now >= b.calmUntil ? this.victimNear(b) : null;
          if (v) { b.state = "chase"; b.target = v.id; this.pathTo(b, v.s.x, v.s.y); }
          else if (!b.path.length) { const [x, y] = this.randomSpot(b.home, b, 12); this.pathTo(b, x, y); }
        }
      }
      // Move.
      const speed = SPEED[b.state];
      let budget = speed * dt;
      while (budget > 0 && b.path.length) {
        const [tx, ty] = b.path[0]!;
        const gx = tileCenter(tx), gy = tileCenter(ty), d = Math.hypot(gx - b.x, gy - b.y);
        if (Math.abs(gx - b.x) > 1) b.facing = gx > b.x ? 1 : -1;
        if (d <= budget) { b.x = gx; b.y = gy; b.path.shift(); budget -= d; } else { b.x += ((gx - b.x) / d) * budget; b.y += ((gy - b.y) / d) * budget; budget = 0; }
      }
      // Catch!
      if (b.state === "chase" && b.target) {
        const p = this.game.pets.get(b.target);
        if (p && Math.hypot(p.s.x - b.x, p.s.y - b.y) < CATCH) this.startDuel(b, p, now, false);
      }
    }
  }

  /** Training Bandit: waits at home, then runs at any pet in its arena and starts a battle. */
  private stepPractice(b: BanditRt, dt: number, now: number) {
    if (b.state === "duel") return;
    if (b.state === "flee") { if (now > b.calmUntil) { b.state = "wander"; b.x = b.homeX!; b.y = b.homeY!; b.path = []; } return; }
    const arena = gladeArenaAt(toTile(b.homeX!), toTile(b.homeY!));
    let target: PetRt | null = null, bd = Infinity;
    if (now >= b.calmUntil) for (const p of this.game.pets.values()) {
      if (p.s.status === "knocked_out" || this.duelFor(p.id)) continue;
      if (gladeArenaAt(toTile(p.s.x), toTile(p.s.y)) !== arena) { this.arrived.delete(p.id); continue; }
      if (!this.arrived.has(p.id)) this.arrived.set(p.id, now);
      if (now - this.arrived.get(p.id)! < 3_000) continue;
      const d = Math.hypot(p.s.x - b.x, p.s.y - b.y);
      if (d < bd) { bd = d; target = p; }
    }
    const gx = target ? target.s.x : b.homeX!, gy = target ? target.s.y : b.homeY!;
    const d = Math.hypot(gx - b.x, gy - b.y);
    b.state = target ? "chase" : "wander";
    if (target && d < CATCH + 8) { this.startDuel(b, target, now, false); return; }
    if (d > 2) {
      const step = Math.min(d, (target ? 120 : 80) * dt);
      if (Math.abs(gx - b.x) > 1) b.facing = gx > b.x ? 1 : -1;
      b.x += ((gx - b.x) / d) * step; b.y += ((gy - b.y) / d) * step;
    }
  }

  private duelFor(petId: string) { for (const d of this.duels.values()) if (d.petId === petId) return d; return null; }

  /** Freeze both fighters and ask the owner to play the attack minigame. */
  private startDuel(b: BanditRt, p: PetRt, now: number, brave: boolean) {
    if (this.duelFor(p.id)) return;
    const id = `duel_${++this.duelSeq}_${now}`;
    this.duels.set(id, { id, banditId: b.id, petId: p.id, ownerId: p.ownerId, brave, deadline: now + DUEL_MS });
    b.state = "duel"; b.path = []; b.target = p.id;
    p.path = []; p.moveDir = null; p.task = null; p.round = null; p.dirty = true;
    this.game.toOwner(p, { t: "bandit_duel", duelId: id, banditId: b.id, banditName: b.name, petId: p.id, petName: p.name, brave, practice: !!b.practice, rounds: DUEL_ROUNDS, deadlineMs: DUEL_MS - 2_000 });
  }

  /** The owner finished the minigame. */
  duelInput(userId: string, duelId: string, hits: number) {
    const d = this.duels.get(duelId);
    if (!d || d.ownerId !== userId) return;
    this.resolveDuel(d, Math.max(0, Math.min(DUEL_ROUNDS, Math.floor(hits) || 0)), Date.now());
  }

  /** Battles nobody played (owner away) resolve on their own with no hits. */
  tickDuels(now: number) {
    for (const d of this.duels.values()) if (now >= d.deadline) this.resolveDuel(d, 0, now);
  }

  private resolveDuel(d: Duel, hits: number, now: number) {
    this.duels.delete(d.id);
    const b = this.list.find((x) => x.id === d.banditId);
    const p = this.game.pets.get(d.petId);
    if (!b) return;
    if (!p) { b.state = "wander"; b.target = null; return; }
    this.fight(b, p, now, d.brave, hits);
  }

  /** Player taps "Fight!" on a nearby bandit: braver pets get a better chance. */
  challenge(p: PetRt, banditId: string, now: number) {
    const b = this.list.find((x) => x.id === banditId);
    if (!b) throw new GameError("gone", "That bandit ran off");
    if (p.s.status === "knocked_out") throw new GameError("ko", `${p.name} is knocked out`);
    if (b.state === "flee") throw new GameError("fled", `${b.name} is running away`);
    if (Math.hypot(p.s.x - b.x, p.s.y - b.y) > 140) throw new GameError("too_far", `Get closer to ${b.name}`);
    if (b.state === "duel") throw new GameError("busy", `${b.name} is already in a battle`);
    this.startDuel(b, p, now, true);
  }

  /**
   * Settle a battle. Each landed attack (0-3) adds to the odds. Win: the bandit
   * flees empty-handed. Lose: it steals the whole bag.
   */
  private fight(b: BanditRt, p: PetRt, now: number, brave: boolean, hits = 0) {
    const s = p.stats;
    const hpShare = p.s.hp / s.maxHp;
    const chance = b.practice
      ? [0.15, 0.55, 0.95, 1][hits]!
      : Math.max(0.1, Math.min(0.95, 0.2 + hits * 0.17 + (s.attack + s.defense - 200) / 400 + (brave ? 0.08 : 0) + (hpShare - 0.5) * 0.2));
    const won = Math.random() < chance;
    if (b.practice) {
      this.game.toastOwner(p, won ? "good" : "info", won ? `${p.name} beat the Training Bandit!` : "The Training Bandit dodged! Practice again — no loot lost.");
      this.game.toOwner(p, { t: "bandit_fight", banditId: b.id, banditName: b.name, petId: p.id, petName: p.name, won, stolen: "", brave });
      b.state = won ? "flee" : "wander"; b.target = null; b.calmUntil = now + (won ? 6_000 : 5_000);
      if (!won) { b.x = b.homeX!; b.y = b.homeY!; } // back off, then try again
      return;
    }
    let stolen = "";
    if (won) {
      p.anim = "attack"; p.animUntil = now + 900;
      p.activity = `Chased off ${b.name}!`;
      this.game.toastOwner(p, "good", `${p.name} beat ${b.name}! The bandit ran away empty-handed.`);
    } else {
      const loot = { ...p.s.inventory };
      stolen = RESOURCES.filter((r) => loot[r] > 0).map((r) => `${loot[r]} ${r === "minerals" ? "stone" : r}`).join(", ");
      p.s.inventory = emptyInventory();
      p.s.hp = Math.max(1, p.s.hp - Math.round(s.maxHp * 0.15));
      p.anim = "hurt"; p.animUntil = now + 900;
      p.activity = `Robbed by ${b.name}!`;
      this.game.toastOwner(p, "bad", stolen ? `${b.name} won the scuffle and snatched ${stolen}!` : `${b.name} won the scuffle but ${p.name}'s bag was empty!`);
    }
    p.dirty = true; p.metaDirty = true;
    this.game.toOwner(p, { t: "bandit_fight", banditId: b.id, banditName: b.name, petId: p.id, petName: p.name, won, stolen, brave });
    b.state = "flee"; b.target = null; b.calmUntil = now + CALM_MS;
    const [x, y] = this.randomSpot(b.home, b, 20);
    this.pathTo(b, x, y);
  }

  private rob(b: BanditRt, p: PetRt, now: number) {
    const stolen = { ...p.s.inventory };
    const parts = RESOURCES.filter((r) => stolen[r] > 0).map((r) => `${stolen[r]} ${r === "minerals" ? "stone" : r}`);
    p.s.inventory = emptyInventory();
    p.anim = "hurt"; p.animUntil = now + 900;
    p.dirty = true; p.metaDirty = true;
    p.activity = `Robbed by ${b.name}!`;
    this.game.toastOwner(p, "bad", `${b.name} snatched ${parts.join(", ")} from ${p.name}! Watch out for bandits.`);
    b.state = "flee"; b.target = null; b.calmUntil = now + CALM_MS;
    const [x, y] = this.randomSpot(b.home, b, 20);
    this.pathTo(b, x, y);
  }

  /** Compact snapshot rows: [id, x, y, state(0 wander · 1 chase · 2 flee), facing]. */
  snapshot(): Array<[string, number, number, number, 1 | -1, string]> {
    return this.list.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.state === "chase" || b.state === "duel" ? 1 : b.state === "flee" ? 2 : 0, b.facing, b.name]);
  }
}

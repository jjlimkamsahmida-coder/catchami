/**
 * Demo rivals: pets of simulated Keepers that roam the Forest and Mining
 * Valley. When your pet is out in the wild and not busy gathering, a rival
 * walks up and challenges it to Bubble Roulette (an invite you can accept or
 * decline). Demo rivals only put bags at stake. Paw Village and the Keeper's
 * Glade are safe. Coach Kiki in the tutorial is the practice partner.
 */
import { ECONOMY, AREA_BOUNDS, areaAt, findPath, gladeArenaAt, inventoryWeight, RESOURCES, tileCenter, toTile, walkable, emptyInventory, Rng, type AreaId } from "@catchami/shared";
import type { Game } from "./game.ts";
import { GameError } from "./game.ts";
import type { PetRt } from "./types.ts";

export type BanditState = "wander" | "chase" | "flee" | "duel";
export interface BanditRt {
  id: string; name: string; home: AreaId; x: number; y: number; facing: 1 | -1;
  path: Array<[number, number]>; state: BanditState; target: string | null;
  nextThink: number; calmUntil: number;
  /** Tutorial training bandit: idle, never chases, never steals. */
  practice?: boolean; homeX?: number; homeY?: number; brave?: boolean;
}

/** Demo rivals: pets of other (simulated) Keepers that roam the wild and challenge you. */
const NAMES = ["Sid's Mochi", "Gus's Biscuit", "Pip's Tofu", "Sue's Noodle", "Ned's Pumpkin", "Lou's Waffles", "Sam's Clover", "Flo's Bean"];
const SPEED = { wander: 70, chase: 150, flee: 165 }; // px/s — pets walk ~170 px/s
const SIGHT = 420;      // px: notices pets this close
const GIVE_UP = 460;    // px: stops chasing beyond this
const CATCH = 44;       // px: close enough to challenge
const PET_COOLDOWN_MS = 45_000; // a pet isn't challenged again by any rival for this long
const CALM_MS = 14_000; // after a battle/invite, a rival wanders for a while
const PER_AREA: Partial<Record<AreaId, number>> = { forest: 5, mines: 4 };
const DUEL_ROUNDS = 3;
/** Same sticker choice as the client (apps/web/src/game/assets.ts banditArt). */
const BANDIT_ART = ["bandit-1", "bandit-2", "bandit-3"];
const hashId = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0; return h; };
const DUEL_MS = 14_000; // the player has this long to play the attack minigame
interface Duel { id: string; banditId: string; petId: string; ownerId: string; brave: boolean; deadline: number }

export class Bandits {
  list: BanditRt[] = [];
  private rng = Rng.fromString("catchami-bandits");
  private duels = new Map<string, Duel>();
  /** When each pet entered the training arena (the Training Bandit lets them settle in first). */
  private arrived = new Map<string, number>();
  /** Pets that already beat Coach Kiki: she leaves them alone (until they replay the battle tutorial). */
  private beaten = new Set<string>();
  private duelSeq = 0;
  /** When each player pet was last challenged by a rival. */
  private challengedAt = new Map<string, number>();

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
      this.list.push({ id: "bandit-practice", name: "Coach Kiki", home: "glade", x, y, facing: -1, path: [], state: "wander", target: null, nextThink: 0, calmUntil: 0, practice: true, homeX: x, homeY: y });
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

  /** A player pet this rival could challenge: owner online, out in this rival's area, ready to battle. */
  private canChallenge(p: PetRt, now: number) {
    if (p.s.status !== "active" || p.matchId || p.busy) return false;
    if (p.s.energy < ECONOMY.battle.minEnergy || p.s.hunger >= ECONOMY.battle.maxHunger || p.listed) return false;
    if (now - (this.challengedAt.get(p.id) ?? 0) < PET_COOLDOWN_MS) return false;
    if (now - p.s.lastBattleAt < ECONOMY.battle.petCooldownSec * 1000) return false;
    return [...this.game.clients].some((c) => c.userId === p.ownerId);
  }

  private victimNear(b: BanditRt, now: number): PetRt | null {
    let best: PetRt | null = null, bd = SIGHT;
    for (const p of this.game.pets.values()) {
      if (!this.canChallenge(p, now)) continue;
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
          const lost = !target || !this.canChallenge(target, now)
            || areaAt(this.game.world, target.s.x, target.s.y).id !== b.home || Math.hypot(target.s.x - b.x, target.s.y - b.y) > GIVE_UP;
          if (lost) { b.state = "wander"; b.target = null; b.path = []; }
          else this.pathTo(b, target!.s.x, target!.s.y);
        }
        if (b.state === "wander") {
          const v = now >= b.calmUntil ? this.victimNear(b, now) : null;
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
      // Close enough: challenge — unless the pet is busy gathering (then just hang around).
      if (b.state === "chase" && b.target) {
        const p = this.game.pets.get(b.target);
        const gathering = !!p && (p.task?.kind === "gather" || !!p.round);
        if (p && !gathering && Math.hypot(p.s.x - b.x, p.s.y - b.y) < CATCH) this.invite(b, p, now);
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
      if (p.s.status === "knocked_out" || this.duelFor(p.id) || this.beaten.has(p.id)) continue;
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

  /** Starting the battle tutorial (again): Coach Kiki may challenge this pet. */
  resetPractice(petId: string) { this.beaten.delete(petId); this.arrived.delete(petId); }

  /** Send a Bubble Roulette invite from this rival. */
  private invite(b: BanditRt, p: PetRt, now: number) {
    this.challengedAt.set(p.id, now);
    const art = BANDIT_ART[hashId(b.id) % BANDIT_ART.length]!;
    if (this.game.arena.inviteBot(p, { banditId: b.id, name: b.name, ownerName: b.name.split("'")[0]!, art, practice: false })) {
      b.state = "duel"; b.path = []; b.target = p.id;
    } else { b.state = "wander"; b.target = null; b.calmUntil = now + 5_000; }
  }

  /** The invite was declined or expired: wander off for a bit. */
  botInviteDone(banditId: string) {
    const b = this.list.find((x) => x.id === banditId);
    if (!b || b.practice || b.state !== "duel") return;
    const now = this.game.now();
    b.state = "flee"; b.target = null; b.calmUntil = now + CALM_MS;
    const [x, y] = this.randomSpot(b.home, b, 16);
    this.pathTo(b, x, y);
  }

  private duelFor(petId: string) { for (const d of this.duels.values()) if (d.petId === petId) return d; return null; }

  /** Freeze both fighters and ask the owner to play the attack minigame. */
  private startDuel(b: BanditRt, p: PetRt, now: number, brave: boolean) {
    if (this.duelFor(p.id)) return;
    // The one battle game is Bubble Roulette: the rival plays its own turns.
    const art = BANDIT_ART[hashId(b.id) % BANDIT_ART.length]!;
    const owner = b.practice ? "Coach" : b.name.split("'")[0]!;
    if (this.game.arena.startBot(p, { banditId: b.id, name: b.name, ownerName: owner, art, practice: !!b.practice })) {
      b.state = "duel"; b.path = []; b.target = p.id; b.brave = brave;
      return;
    }
    if (b.practice) return; // couldn't start (busy / offline): try again later
    if (brave) throw new GameError("not_eligible", `${p.name} can't battle right now (needs ${ECONOMY.battle.minEnergy}+ energy, not too hungry, not gathering)`);
    return;

    const id = `duel_${++this.duelSeq}_${now}`;
    this.duels.set(id, { id, banditId: b.id, petId: p.id, ownerId: p.ownerId, brave, deadline: now + DUEL_MS });
    b.state = "duel"; b.path = []; b.target = p.id;
    p.path = []; p.moveDir = null; p.task = null; p.round = null; p.dirty = true;
    this.game.toOwner(p, { t: "bandit_duel", duelId: id, banditId: b.id, banditName: b.name, petId: p.id, petName: p.name, brave, practice: !!b.practice, rounds: DUEL_ROUNDS, deadlineMs: DUEL_MS - 2_000 });
  }

  /** A Bubble Roulette match against this rival ended. */
  botMatchDone(banditId: string, petId: string, playerWon: boolean) {
    const b = this.list.find((x) => x.id === banditId);
    const p = this.game.pets.get(petId);
    if (!b) return;
    if (!p) { b.state = "wander"; b.target = null; return; }
    if (b.practice) { this.fight(b, p, this.game.now(), !!b.brave, 0, playerWon); return; }
    // Demo rival: spoils were settled by the match. Walk away for a while.
    const now = this.game.now();
    this.challengedAt.set(p.id, now);
    b.state = "flee"; b.target = null; b.calmUntil = now + CALM_MS;
    const [x, y] = this.randomSpot(b.home, b, 20);
    this.pathTo(b, x, y);
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
    if (!b) throw new GameError("gone", "That Keeper left");
    if (p.s.status === "knocked_out") throw new GameError("ko", `${p.name} is knocked out`);
    if (b.state === "flee") throw new GameError("fled", `${b.name} is heading off`);
    if (Math.hypot(p.s.x - b.x, p.s.y - b.y) > 140) throw new GameError("too_far", `Get closer to ${b.name}`);
    if (b.state === "duel") throw new GameError("busy", `${b.name} is already in a battle`);
    this.startDuel(b, p, now, true);
  }

  /**
   * Settle a battle. Each landed attack (0-3) adds to the odds. Win: the bandit
   * flees empty-handed. Lose: it steals the whole bag.
   */
  private fight(b: BanditRt, p: PetRt, now: number, brave: boolean, hits = 0, forced?: boolean) {
    const s = p.stats;
    const hpShare = p.s.hp / s.maxHp;
    const chance = b.practice
      ? [0.15, 0.55, 0.95, 1][hits]!
      : Math.max(0.1, Math.min(0.95, 0.2 + hits * 0.17 + (s.attack + s.defense - 200) / 400 + (brave ? 0.08 : 0) + (hpShare - 0.5) * 0.2));
    const won = forced ?? Math.random() < chance;
    const quiet = forced !== undefined; // Bubble Roulette already showed the result
    if (b.practice) {
      if (!quiet) this.game.toastOwner(p, won ? "good" : "info", won ? `${p.name} won the practice battle!` : "Coach Kiki won this one — practise again, no loot lost.");
      this.game.toOwner(p, { t: "bandit_fight", banditId: b.id, banditName: b.name, petId: p.id, petName: p.name, won, stolen: "", brave, quiet });
      if (won) this.beaten.add(p.id);
      b.state = won ? "flee" : "wander"; b.target = null; b.calmUntil = now + (won ? 6_000 : 5_000);
      if (!won) { b.x = b.homeX!; b.y = b.homeY!; } // back off, then try again
      return;
    }
    let stolen = "";
    if (won) {
      p.anim = "attack"; p.animUntil = now + 900;
      p.activity = `Chased off ${b.name}!`;
      if (!quiet) this.game.toastOwner(p, "good", `${p.name} beat ${b.name} in battle!`);
    } else {
      const loot = { ...p.s.inventory };
      stolen = RESOURCES.filter((r) => loot[r] > 0).map((r) => `${loot[r]} ${r === "minerals" ? "stone" : r}`).join(", ");
      p.s.inventory = emptyInventory();
      p.s.hp = Math.max(1, p.s.hp - Math.round(s.maxHp * 0.15));
      p.anim = "hurt"; p.animUntil = now + 900;
      p.activity = `Robbed by ${b.name}!`;
      this.game.toastOwner(p, "bad", stolen && quiet ? `${b.name} took ${stolen} from your bag!` : stolen ? `${b.name} won the battle and took ${stolen}!` : `${b.name} won the battle — luckily ${p.name}'s bag was empty!`);
    }
    p.dirty = true; p.metaDirty = true;
    this.game.toOwner(p, { t: "bandit_fight", banditId: b.id, banditName: b.name, petId: p.id, petName: p.name, won, stolen, brave, quiet });
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
    this.game.toastOwner(p, "bad", `${b.name} won and took ${parts.join(", ")} from ${p.name}!`);
    b.state = "flee"; b.target = null; b.calmUntil = now + CALM_MS;
    const [x, y] = this.randomSpot(b.home, b, 20);
    this.pathTo(b, x, y);
  }

  /** Compact snapshot rows: [id, x, y, state(0 wander · 1 chase · 2 flee), facing]. */
  snapshot(): Array<[string, number, number, number, 1 | -1, string]> {
    return this.list.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.state === "chase" || b.state === "duel" ? 1 : b.state === "flee" ? 2 : 0, b.facing, b.name]);
  }
}

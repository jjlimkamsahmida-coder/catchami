/** Wire protocol between the authoritative game server and clients. */
import type { CatchTier, EquipmentKind, Rarity, Resource, Species, Stats } from "./config.ts";
import type { Inventory } from "./combat.ts";
import type { Amount } from "./money.ts";
import type { DemandLevel } from "./economy.ts";

export type PetStatus = "active" | "sleeping" | "knocked_out" | "inactive";
export type PetAnim = "idle" | "walk" | "gather" | "trade" | "attack" | "hurt" | "ko" | "eat" | "sleep";

export interface PetLook { hue: number; outline: number; pattern: number; bounce: number }

export type WorkPriority = "low" | "balanced" | "high";
export type SellStrategy = "immediate" | "full" | "best_price" | "nearest" | "hold";
export type BattleStrategy = "avoid" | "defensive" | "balanced" | "aggressive";

export interface Strategy {
  auto: boolean;
  work: WorkPriority;
  resource: Resource | "demand";
  sell: SellStrategy;
  hold: Resource[];
  battle: BattleStrategy;
  /** Minimum HP share (bps) before the pet will fight. */
  minHpBps: number;
  /** Max carried weight the pet will risk walking around with before selling. */
  maxCarryRiskBps: number;
  realWager: boolean;
  maxWager: Amount;
  dailyWagerLoss: Amount;
  /** Keep this many fish as emergency food. */
  foodReserve: number;
  /** Buy/eat when hunger is above this (0..1000). */
  eatAtHunger: number;
  buyMedicine: boolean;
  /** Stop working and rest below this energy. */
  restBelowEnergy: number;
}

export const DEFAULT_STRATEGY: Strategy = {
  auto: true,
  work: "balanced",
  resource: "demand",
  sell: "full",
  hold: [],
  battle: "avoid",
  minHpBps: 5_000,
  maxCarryRiskBps: 10_000,
  realWager: false,
  maxWager: "0",
  dailyWagerLoss: "0",
  foodReserve: 1,
  eatAtHunger: 600,
  buyMedicine: true,
  restBelowEnergy: 150,
};

/** What everyone sees. No HP, attack, defense, energy, traits or strategy. */
export interface PublicPet {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  species: Species;
  rarity: Rarity;
  look: PetLook;
  sticker: string | null;
  status: PetStatus;
  balance: Amount;
  carried: Inventory;
  equipment: EquipmentKind[];
}

/** Compact 10 Hz position update: [id, x, y, anim, facing]. */
export type PetPos = [string, number, number, PetAnim, 1 | -1];

export interface EquipmentView { id: string; kind: EquipmentKind; rarity: Rarity; equipped: boolean }

/** Owner-only view. */
export interface OwnPet extends PublicPet {
  x: number;
  y: number;
  autopilotResumesAt: number | null;
  /** When the pet was caught (ms). */
  createdAt: number;
  listed: boolean;
  hp: number;
  energy: number;
  hunger: number;
  stats: Stats;
  baseStats: Stats;
  traits: string[];
  strategy: Strategy;
  available: Amount;
  held: Amount;
  koUntil: number | null;
  activity: string;
  nftTokenId: string | null;
  mintStatus: "pending" | "minted" | "awaiting_chain";
  gatheredToday: number;
  wins: number;
  losses: number;
}

/** [id, x, y, state (0 wander · 1 chase · 2 flee), facing, name] */
export type BanditRow = [string, number, number, number, 1 | -1, string];
export interface MerchantPublic { id: string; name: string; x: number; y: number; state: "travelling" | "returning" | "at_hq" | "unavailable"; hue: number }
export interface MerchantDetail {
  id: string;
  cash: Amount;
  inventory: Inventory;
  capacityLeft: number;
  prices: Record<Resource, Amount>;
}

export interface NodeState { id: string; remaining: number }

export interface MarketTicker {
  demand: Record<Resource, { level: DemandLevel; indexBps: number }>;
  hqStock: Inventory;
  treasuryFactorBps: number;
}

export type ClientMsg =
  | { t: "hello"; token: string }
  | { t: "select"; petId: string }
  | { t: "move"; dx: number; dy: number }
  | { t: "goto"; x: number; y: number }
  | { t: "gather"; petId: string; nodeId: string }
  | { t: "sell"; petId: string; merchantId: string; items: Partial<Inventory> }
  | { t: "buy"; petId: string; item: "food" | "medicine"; rid: string }
  | { t: "eat_own"; petId: string }
  | { t: "rest"; petId: string }
  | { t: "challenge"; petId: string; targetId: string }
  | { t: "strategy"; petId: string; strategy: Strategy }
  | { t: "ping"; at: number }
  | { t: "mg_input"; roundId: string; ms: number }
  | { t: "mg_stop"; petId: string }
  | { t: "br_challenge"; petId: string; targetId: string }
  | { t: "br_respond"; matchId: string; accept: boolean }
  | { t: "br_action"; matchId: string; target: "self" | "opponent"; turnNo: number }
  | { t: "br_forfeit"; matchId: string }
  | { t: "br_sync" }
  | { t: "tutorial"; petId: string; action: "enter" | "exit" | "stage"; stage?: number }
  | { t: "fight_bandit"; petId: string; banditId: string };

export interface BattleEvent {
  id: string;
  a: string;
  b: string;
  winner: string | null;
  exchanges: Array<{ attacker: 0 | 1; hit: boolean; crit: boolean; damage: number }>;
  stolen: Inventory;
  x: number;
  y: number;
}

export type ServerMsg =
  | {
      t: "welcome";
      userId: string;
      displayName: string;
      network: string;
      map: { w: number; h: number; tiles: string; seed: string };
      nodes: Array<{ id: string; resource: Resource; tx: number; ty: number }>;
      pois: Array<{ id: string; label: string; tx: number; ty: number }>;
      hq: { tx: number; ty: number };
      controlled: string | null;
    }
  | { t: "snap"; tick: number; p: PetPos[]; m: MerchantPublic[]; b?: BanditRow[] }
  | { t: "bandit_fight"; banditId: string; banditName: string; petId: string; petName: string; won: boolean; stolen: string; brave: boolean }
  | { t: "meta"; pets: PublicPet[]; nodes: NodeState[] }
  | { t: "own"; pets: OwnPet[]; wallet: { available: Amount }; controlled: string | null }
  | { t: "merchant"; detail: MerchantDetail | null; id: string }
  | { t: "market"; ticker: MarketTicker }
  | { t: "battle"; battle: BattleEvent }
  | { t: "toast"; kind: "info" | "good" | "bad"; text: string; petId?: string }
  | { t: "error"; code: string; message: string; rid?: string }
  | { t: "pong"; at: number; serverTime: number }
  | { t: "mg_round"; round: import("./minigames.ts").MinigameRound }
  | { t: "mg_result"; roundId: string; petId: string; nodeId: string; resource: import("./config.ts").Resource; grade: import("./minigames.ts").Grade; gained: number; detail: string; note?: string }
  | { t: "mg_end"; petId: string; reason: string }
  | { t: "br_invite"; matchId: string; from: { petId: string; name: string; ownerName: string; species: Species; rarity: Rarity; sticker: string | null; look: PetLook }; toPetId: string; expiresAt: number }
  | { t: "br_state"; match: BubbleMatchView };

export interface BubbleSide {
  petId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  species: Species;
  rarity: Rarity;
  sticker: string | null;
  look: PetLook;
  battleHp: number;
  startHp: number;
  connected: boolean;
}

export interface BubbleMatchView {
  id: string;
  state: "invited" | "active" | "finished" | "cancelled";
  a: BubbleSide;
  b: BubbleSide;
  you: "a" | "b" | null;
  turn: "a" | "b";
  turnNo: number;
  /** Server clock (ms) when the current turn times out. */
  turnEndsAt: number;
  chamberNo: number;
  slotsLeft: number;
  splashesLeft: number;
  last: { by: "a" | "b"; target: "a" | "b"; loaded: boolean; reloaded: boolean; turnNo: number } | null;
  winner: "a" | "b" | null;
  reason: string;
  epoch: number;
  commitment: string;
  mode: "nonredeemable";
}

export interface CatchQuote {
  tier: CatchTier;
  cost: Amount;
  successPpm: number;
  rarityPpm: Record<Rarity, number>;
  split: { pet: Amount; hq: Amount; team: Amount };
  failedToHq: Amount;
}

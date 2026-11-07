import {
  DEFAULT_STRATEGY, ECONOMY, effectiveStats, emptyInventory,
  type EquipmentKind, type EquippedItem, type Inventory, type PetAnim, type PetGenome, type PetStatus,
  type Rarity, type Resource, type Species, type Stats, type Strategy,
} from "@catchami/shared";

export interface PetState {
  hp: number;
  energy: number;
  hunger: number;
  x: number;
  y: number;
  inventory: Inventory;
  status: PetStatus;
  koUntil: number | null;
  strategy: Strategy;
  gatheredToday: number;
  gatherDay: string;
  gatheredTotal: number;
  wins: number;
  losses: number;
  stolenTotal: number;
  lastBattleAt: number;
  recentOpponents: Record<string, number>;
}

export type Task =
  | { kind: "gather"; nodeId: string; endsAt: number | null; repeat: boolean }
  | { kind: "rest" }
  | { kind: "sell"; merchantId: string }
  | null;

export interface PetRt {
  id: string;
  ownerId: string;
  ownerName: string;
  name: string;
  species: Species;
  rarity: Rarity;
  genome: PetGenome;
  sticker: string | null;
  nftTokenId: string | null;
  mintStatus: "pending" | "minted" | "awaiting_chain";
  createdAt: number;
  equipment: Array<{ id: string; kind: EquipmentKind; rarity: Rarity }>;
  stats: Stats;
  s: PetState;
  // runtime only
  path: Array<[number, number]>;
  moveDir: { dx: number; dy: number; until: number } | null;
  facing: 1 | -1;
  anim: PetAnim;
  animUntil: number;
  task: Task;
  busy: boolean;
  manualUntil: number;
  nextThink: number;
  balance: bigint;
  held: bigint;
  listed: boolean;
  activity: string;
  dirty: boolean;
  metaDirty: boolean;
}

export interface MerchantRt {
  id: string;
  name: string;
  hue: number;
  prefs: Partial<Record<Resource, number>>;
  route: string[]; // POI ids, starting and ending at hq
  legIdx: number;
  path: Array<[number, number]>;
  x: number;
  y: number;
  state: "travelling" | "returning" | "at_hq" | "unavailable";
  waitUntil: number;
  cash: bigint;
  inventory: Inventory;
  tripNo: number;
  busy: Promise<unknown>;
}

export interface NodeRt { id: string; resource: Resource; tx: number; ty: number; remaining: number; nextRegen: number }

export function freshPetState(x: number, y: number, stats: Stats): PetState {
  return {
    hp: stats.maxHp,
    energy: stats.maxEnergy,
    hunger: 200,
    x, y,
    inventory: emptyInventory(),
    status: "active",
    koUntil: null,
    strategy: { ...DEFAULT_STRATEGY },
    gatheredToday: 0,
    gatherDay: "",
    gatheredTotal: 0,
    wins: 0,
    losses: 0,
    stolenTotal: 0,
    lastBattleAt: 0,
    recentOpponents: {},
  };
}

export function recomputeStats(p: Pick<PetRt, "genome" | "equipment">): Stats {
  const items: EquippedItem[] = p.equipment.map((e) => ({ kind: e.kind, rarity: e.rarity }));
  return effectiveStats(p.genome.stats, items.slice(0, ECONOMY.equipment.slots));
}

export const MERCHANT_DEFS: Array<Pick<MerchantRt, "id" | "name" | "hue" | "prefs" | "route">> = [
  { id: "finn", name: "Finn the Fishmonger", hue: 200, prefs: { fish: 1_200, wood: -600 }, route: ["hq", "lakeside", "southwest", "lakeside", "hq"] },
  { id: "marigold", name: "Sage Marigold", hue: 120, prefs: { herbs: 1_200, minerals: -600 }, route: ["hq", "meadow", "southwest", "hq"] },
  { id: "tom", name: "Timber Tom", hue: 30, prefs: { wood: 1_200, fish: -600 }, route: ["hq", "lakeside", "forest", "northgate", "hq"] },
  { id: "ruby", name: "Rocky Ruby", hue: 330, prefs: { minerals: 1_200, herbs: -600 }, route: ["hq", "northgate", "pass", "highland", "pass", "hq"] },
];

/**
 * Versioned economy configuration. Every balancing number lives here so it can
 * be reviewed, simulated (apps/server/src/sim) and published. Bump `version`
 * on any change; the server records the version on every financial journal.
 *
 * Token prices are in WHOLE $CATCHAMI and converted with tokens(). They are
 * pre-launch assumptions pending simulation and a real market price.
 */
import { tokens } from "./money.ts";

export const SPECIES = ["cat", "dog"] as const;
export type Species = (typeof SPECIES)[number];

export const RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;
export type Rarity = (typeof RARITIES)[number];

export const RESOURCES = ["fish", "herbs", "wood", "minerals"] as const;
export type Resource = (typeof RESOURCES)[number];

export const CATCH_TIERS = ["basic", "enhanced", "premium"] as const;
export type CatchTier = (typeof CATCH_TIERS)[number];

export const EQUIPMENT_KINDS = ["boots", "gloves", "armor", "heavy_armor", "tool", "weapon"] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

/** Probabilities are integers in parts-per-million so they are exact. */
export const PPM = 1_000_000;

export const ECONOMY = {
  version: "2026-11-07.1",

  allocation: {
    hqWhole: 40_000_000_000_000n,
    marketWhole: 55_000_000_000_000n,
    teamWhole: 5_000_000_000_000n,
  },

  catch: {
    tiers: {
      basic: { cost: tokens(1_000_000), successPpm: 600_000 },
      enhanced: { cost: tokens(3_000_000), successPpm: 800_000 },
      premium: { cost: tokens(8_000_000), successPpm: 950_000 },
    } satisfies Record<CatchTier, { cost: bigint; successPpm: number }>,
    /** Rarity table after a successful catch, per tier, in ppm. Each row sums to 1e6. */
    rarityPpm: {
      basic: { common: 700_000, uncommon: 220_000, rare: 70_000, epic: 9_000, legendary: 950, mythic: 50 },
      enhanced: { common: 600_000, uncommon: 280_000, rare: 100_000, epic: 18_000, legendary: 1_900, mythic: 100 },
      premium: { common: 480_000, uncommon: 320_000, rare: 160_000, epic: 35_000, legendary: 4_500, mythic: 500 },
    } satisfies Record<CatchTier, Record<Rarity, number>>,
    /** Successful catch split (bps). */
    successSplit: { pet: 8_000, hq: 1_800, team: 200 },
    /** Valid detection but failed catch: everything to HQ. */
    failedSplit: { hq: 10_000 },
    maxCapturesPerUserPerDay: 30,
    minDetectionScore: 0.6,
    duplicateHammingThreshold: 6,
  },

  /** Max aggregate stat benefit from rarity, in bps, distributed across stats. */
  rarityBonusBudgetBps: { common: 0, uncommon: 100, rare: 200, epic: 300, legendary: 400, mythic: 500 } satisfies Record<Rarity, number>,
  /** Individual natural variation per stat, +/- bps. Bigger than rarity on purpose. */
  naturalVariationBps: 400,

  stats: {
    maxHp: 1000,
    maxEnergy: 1000,
    hungerMax: 1000,
    /** Hunger gained per second (0 = full, 1000 = starving). ~8h from full to starving. */
    hungerPerSec: 1000 / (8 * 3600),
    starvingEnergyDrainPerSec: 0.25,
    walkEnergyPerSec: 0.35,
    gatherEnergyPerUnit: 3,
    battleEnergyPerExchange: 12,
    restEnergyPerSec: 0.6,
    restMaxHunger: 700,
    knockoutCooldownSec: 3 * 3600,
    /** Below this energy the pet is too tired to gather or fight. */
    exhaustedEnergy: 40,
  },

  food: {
    price: tokens(12_000),
    hungerRestore: 350,
    energyRestore: 220,
    fishPerMeal: 1,
    /** Eating your own carried fish: no tokens, smaller effect. */
    ownFishHunger: 220,
    ownFishEnergy: 120,
    split: { hq: 9_000, team: 1_000 },
  },
  medicine: {
    price: tokens(60_000),
    herbsPerDose: 2,
    /** Heals this share of max HP (bps). Also required to revive after the KO cooldown. */
    healBps: 4_000,
    split: { hq: 9_000, team: 1_000 },
  },

  resources: {
    fish: { basePrice: tokens(2_000), weight: 2, gatherMs: 5_000, nodeCapacity: 14, regenMs: 70_000 },
    herbs: { basePrice: tokens(2_600), weight: 1, gatherMs: 4_200, nodeCapacity: 12, regenMs: 80_000 },
    wood: { basePrice: tokens(1_800), weight: 3, gatherMs: 5_500, nodeCapacity: 16, regenMs: 60_000 },
    minerals: { basePrice: tokens(3_200), weight: 4, gatherMs: 7_000, nodeCapacity: 10, regenMs: 110_000 },
  } satisfies Record<Resource, { basePrice: bigint; weight: number; gatherMs: number; nodeCapacity: number; regenMs: number }>,

  demand: {
    /** Exponential smoothing half-life for consumption/supply rates. */
    halfLifeSec: 3 * 3600,
    minIndexBps: 6_000,
    maxIndexBps: 17_500,
    /** Max change of the published index per recompute. */
    maxStepBps: 250,
    recomputeSec: 60,
    lowBelowBps: 9_000,
    highAboveBps: 11_500,
  },

  hq: {
    reserveFloorBps: 500, // 5% of the original HQ allocation
    dailyBudgetBpsOfAvailable: 5, // 0.05%
    merchantShareBps: 8_500,
    rewardShareBps: 1_500,
    /** Above floor * this multiple, budgets run at 100%. Linearly scaled down to 0 at the floor. */
    taperStartMultiple: 3,
  },

  merchants: {
    count: 4,
    inventoryCapacity: 400,
    tripMinBudget: tokens(20_000_000),
    tripMaxBudget: tokens(2_000_000_000),
    speedPxPerSec: 34,
    interactRangePx: 72,
    restAtHqMs: 25_000,
    /** Return to HQ when cash below this share of trip budget. */
    lowFundsBps: 800,
  },

  battle: {
    maxExchanges: 8,
    theftMaxBps: 1_500,
    petCooldownSec: 90,
    sameOpponentCooldownSec: 30 * 60,
    challengeRangePx: 110,
    minHpBpsDefault: 5_000,
    realTokenPvp: {
      /** Hard release control. Requires legal approval + config + contract escrow to flip. */
      enabled: false,
      maxStakeBpsOfAvailable: 500,
      dailyLossBpsOfAuthorized: 2_000,
      feeBpsOfPot: 200,
      feeSplit: { hq: 9_000, team: 1_000 },
    },
  },

  equipment: {
    slots: 2,
    /** Cap on summed positive equipment bonus across all stats (bps). */
    totalBonusCapBps: 1_200,
    craftSplit: { hq: 9_000, team: 1_000 },
    rarityMultiplierBps: { common: 10_000, uncommon: 10_500, rare: 11_000, epic: 11_500, legendary: 12_000, mythic: 12_500 } satisfies Record<Rarity, number>,
  },

  marketplace: {
    feeBps: 200,
    feeSplit: { hq: 9_000, team: 1_000 },
  },

  rewards: {
    zeroOutcomePpm: 300_000,
    minReward: tokens(2_000),
    maxReward: tokens(40_000),
    minGatheredToday: 5,
    minPetAgeSec: 24 * 3600,
    rarityMultiplierBps: { common: 10_000, uncommon: 10_100, rare: 10_200, epic: 10_300, legendary: 10_400, mythic: 10_500 } satisfies Record<Rarity, number>,
  },

  world: {
    tileSize: 32,
    tickHz: 10,
    viewRadiusPx: 900,
  },
} as const;

export type EconomyConfig = typeof ECONOMY;

export const EQUIPMENT: Record<
  EquipmentKind,
  { label: string; fee: bigint; wood: number; minerals: number; bonusBps: Partial<Record<StatKey, number>> }
> = {
  boots: { label: "Trail Boots", fee: tokens(40_000), wood: 6, minerals: 2, bonusBps: { speed: 600 } },
  gloves: { label: "Picker Gloves", fee: tokens(40_000), wood: 4, minerals: 3, bonusBps: { gather: 500 } },
  armor: { label: "Bark Armor", fee: tokens(70_000), wood: 8, minerals: 6, bonusBps: { defense: 700 } },
  heavy_armor: { label: "Heavy Stone Armor", fee: tokens(90_000), wood: 4, minerals: 12, bonusBps: { defense: 1_100, speed: -600 } },
  tool: { label: "Forager's Tool", fee: tokens(50_000), wood: 7, minerals: 4, bonusBps: { gather: 300, carry: 400 } },
  weapon: { label: "Pebble Sling", fee: tokens(70_000), wood: 5, minerals: 8, bonusBps: { attack: 700 } },
};

export const STAT_KEYS = ["maxHp", "maxEnergy", "attack", "defense", "gather", "speed", "luck", "carry"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;

export const SPECIES_BASE: Record<Species, Stats> = {
  cat: { maxHp: 950, maxEnergy: 1000, attack: 104, defense: 94, gather: 100, speed: 112, luck: 108, carry: 56 },
  dog: { maxHp: 1050, maxEnergy: 1000, attack: 100, defense: 104, gather: 100, speed: 100, luck: 96, carry: 66 },
};

/** Modest species gathering affinities (bps bonus on gather speed for that resource). */
export const SPECIES_AFFINITY: Record<Species, Partial<Record<Resource, number>>> = {
  cat: { fish: 800, herbs: 300 },
  dog: { wood: 600, minerals: 500 },
};

export interface TraitDef {
  id: string;
  label: string;
  statBps: Partial<Record<StatKey, number>>;
  affinityBps?: Partial<Record<Resource, number>>;
}

/** Traits are hidden from other players. Each pet rolls two distinct traits. */
export const TRAITS: TraitDef[] = [
  { id: "swimmer", label: "Swimmer", statBps: {}, affinityBps: { fish: 600 } },
  { id: "forager", label: "Forager", statBps: {}, affinityBps: { herbs: 600 } },
  { id: "lumberjack", label: "Lumberjack", statBps: {}, affinityBps: { wood: 600 } },
  { id: "digger", label: "Digger", statBps: {}, affinityBps: { minerals: 600 } },
  { id: "sturdy", label: "Sturdy", statBps: { defense: 300, speed: -150 } },
  { id: "scrappy", label: "Scrappy", statBps: { attack: 300, defense: -150 } },
  { id: "packrat", label: "Packrat", statBps: { carry: 500, speed: -100 } },
  { id: "zoomies", label: "Zoomies", statBps: { speed: 400, maxEnergy: -200 } },
  { id: "lucky", label: "Lucky Whiskers", statBps: { luck: 500 } },
  { id: "tireless", label: "Tireless", statBps: { maxEnergy: 400, attack: -100 } },
  { id: "chonk", label: "Chonk", statBps: { maxHp: 400, speed: -200 } },
  { id: "nimble", label: "Nimble", statBps: { speed: 200, defense: -100, luck: 100 } },
];

export const PET_NAMES = [
  "Mochi", "Biscuit", "Pickle", "Noodle", "Tofu", "Waffles", "Bean", "Pudding", "Sprout", "Maple",
  "Pepper", "Nugget", "Dumpling", "Crumpet", "Olive", "Taco", "Miso", "Peanut", "Clover", "Juniper",
  "Pip", "Fig", "Bao", "Socks", "Ziggy", "Lentil", "Churro", "Pumpkin", "Sesame", "Kiwi",
];

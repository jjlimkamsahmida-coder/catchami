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
/** Player-facing names ("minerals" is mined as stone in Mining Valley). */
export const RESOURCE_LABEL = { fish: "Fish", herbs: "Herbs", wood: "Wood", minerals: "Stone" } as const;
export type Resource = (typeof RESOURCES)[number];

export const CATCH_TIERS = ["basic", "enhanced", "premium"] as const;
export type CatchTier = (typeof CATCH_TIERS)[number];

export const EQUIPMENT_KINDS = ["boots", "gloves", "armor", "heavy_armor", "tool", "weapon"] as const;
export type EquipmentKind = (typeof EQUIPMENT_KINDS)[number];

/** Probabilities are integers in parts-per-million so they are exact. */
export const PPM = 1_000_000;

export const ECONOMY = {
  version: "2026-11-13.1",

  allocation: {
    hqWhole: 40_000_000_000_000n,
    marketWhole: 55_000_000_000_000n,
    teamWhole: 5_000_000_000_000n,
  },

  catch: {
    tiers: {
      basic: { cost: tokens(1_000_000), successPpm: 600_000 },
      enhanced: { cost: tokens(3_000_000), successPpm: 800_000 },
      premium: { cost: tokens(8_000_000), successPpm: 1_000_000 },
    } satisfies Record<CatchTier, { cost: bigint; successPpm: number }>,
    /** Rarity table after a successful catch, per tier, in ppm. Each row sums to 1e6. */
    rarityPpm: {
      // DEMO odds (hackathon build): rare pets are easy to find. Restore production odds before launch.
      basic: { common: 300_000, uncommon: 250_000, rare: 200_000, epic: 120_000, legendary: 80_000, mythic: 50_000 },
      enhanced: { common: 200_000, uncommon: 220_000, rare: 220_000, epic: 160_000, legendary: 120_000, mythic: 80_000 },
      premium: { common: 100_000, uncommon: 150_000, rare: 250_000, epic: 200_000, legendary: 180_000, mythic: 120_000 },
    } satisfies Record<CatchTier, Record<Rarity, number>>,
    /** Successful catch split (bps). */
    /** Successful catch split (bps): a starting purse for the pet, HQ (paid back out to players), the team. */
    successSplit: { pet: 4_000, hq: 5_000, team: 1_000 },
    /** Valid detection but failed catch: everything to HQ. */
    failedSplit: { hq: 10_000 },
    maxCapturesPerUserPerDay: 30,
    /** A player's first ever catch always succeeds (rarity is still a fair roll). */
    firstCatchGuaranteed: true,
    /** One-time starter grant on testnet/dev so a new player can afford their first CamiCube and meals. */
    starterGrantWhole: 10_000_000,
    /**
     * Starter packs for the first-time "buy $CATCHAMI" step. On test networks this is a
     * simulated purchase (test NEAR price shown, coins credited as test units); one per account.
     */
    starterPacks: [
      { id: "sprout", name: "Sprout Pouch", whole: 10_000_000, near: "1", tag: "", tier: "basic" as CatchTier },
      { id: "bloom", name: "Bloom Bag", whole: 25_000_000, near: "2", tag: "Popular", tier: "enhanced" as CatchTier },
      { id: "grove", name: "Grove Chest", whole: 60_000_000, near: "4", tag: "Best value", tier: "premium" as CatchTier },
    ],
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
    /** Hunger gained per second (0 = full, 1000 = starving). 5 hours from full to starving: ~6 meals a day of upkeep (~40–50% of a working pet's income in the simulation). */
    hungerPerSec: 1000 / (5 * 3600),
    starvingEnergyDrainPerSec: 0.6,
    walkEnergyPerSec: 1,
    /** Bags hold this many times their base carry stat ("earn more": every hit gives 10× units). */
    carryScale: 10,
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
    fishPerMeal: 10,
    /** HQ kitchen out of local fish? Meals are imported at this price multiple (bps), so pets never get stuck. */
    importMultBps: 20_000,
    split: { hq: 9_000, team: 1_000 },
  },
  medicine: {
    price: tokens(60_000),
    herbsPerDose: 20,
    importMultBps: 20_000,
    /** Heals this share of max HP (bps). Also required to revive after the KO cooldown. */
    healBps: 4_000,
    split: { hq: 9_000, team: 1_000 },
  },

  /**
   * Every resource is worth the same per bag slot (100 per weight) and costs
   * energy/hunger in proportion to its weight (energy 1.5×, hunger 0.75×), so
   * no resource is a "best" grind: pick by price/demand, merchant and species.
   */
  resources: {
    fish: { basePrice: tokens(200), weight: 2, energy: 3, hunger: 1.5, gatherMs: 5_000, regenMs: 70_000 },
    herbs: { basePrice: tokens(100), weight: 1, energy: 1.5, hunger: 0.75, gatherMs: 4_200, regenMs: 80_000 },
    wood: { basePrice: tokens(300), weight: 3, energy: 4.5, hunger: 2.25, gatherMs: 5_500, regenMs: 60_000 },
    minerals: { basePrice: tokens(400), weight: 4, energy: 6, hunger: 3, gatherMs: 7_000, regenMs: 110_000 },
  } satisfies Record<Resource, { basePrice: bigint; weight: number; energy: number; hunger: number; gatherMs: number; regenMs: number }>,

  gather: {
    /** Units per successful hit (autopilot gathering, and a "good" minigame tap). */
    unitsPerHit: 10,
    /** Each resource spot holds a fixed stock in this range (deterministic per spot). */
    nodeStockMin: 100_000,
    nodeStockMax: 500_000,
  },

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
    /**
     * Daily merchant budget = min(0.01% × spendable reserve + 60% × 7-day average daily revenue,
     *                             0.03% × spendable reserve). Spendable = HQ available − floor.
     */
    budgetReserveBps: 1,
    budgetRevenueShareBps: 6_000,
    budgetCapReserveBps: 3,
    revenueWindowDays: 7,
    /** Above floor * this multiple, budgets run at 100%. Linearly scaled down to 0 at the floor. */
    taperStartMultiple: 3,
  },

  merchants: {
    count: 4,
    inventoryCapacity: 4_000,
    /** A full cart (4,000 weight × ~100 per weight × max demand) is worth well under 1M: purses match that. */
    tripMinBudget: tokens(200_000),
    tripMaxBudget: tokens(2_000_000),
    speedPxPerSec: 52,
    interactRangePx: 72,
    restAtHqMs: 25_000,
    /** Return to HQ when cash below this share of trip budget. */
    lowFundsBps: 800,
  },

  battle: {
    maxExchanges: 8,
    theftMaxBps: 1_500,
    /**
     * Bubble Roulette spoils: the winner takes a random share of the loser's
     * coins (above a protected purse) and of each resource in the loser's bag.
     * share = base × (2·luckW / (luckW + luckL)) × random(0.5–1.5), clamped to [min, max].
     * A fee on the coins taken goes to HQ/team.
     */
    stake: {
      baseShareBps: 1_000,
      minShareBps: 200,
      maxShareBps: 1_500,
      protectedCoins: tokens(50_000),
      feeBps: 1_000,
      feeSplit: { hq: 9_000, team: 1_000 },
    },
    /** Each match costs both pets this much energy and hunger (on top of the HP it costs). */
    matchEnergy: 80,
    matchHunger: 60,
    minEnergy: 120,
    maxHunger: 900,
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

  /** 5% on every pet/gear sale: half is the creator royalty (team), half goes to HQ. */
  marketplace: {
    feeBps: 500,
    feeSplit: { hq: 5_000, team: 5_000 },
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
  boots: { label: "Trail Boots", fee: tokens(40_000), wood: 60, minerals: 20, bonusBps: { speed: 600 } },
  gloves: { label: "Picker Gloves", fee: tokens(40_000), wood: 40, minerals: 30, bonusBps: { gather: 500 } },
  armor: { label: "Bark Armor", fee: tokens(70_000), wood: 80, minerals: 60, bonusBps: { defense: 700 } },
  heavy_armor: { label: "Heavy Stone Armor", fee: tokens(90_000), wood: 40, minerals: 120, bonusBps: { defense: 1_100, speed: -600 } },
  tool: { label: "Forager's Tool", fee: tokens(50_000), wood: 70, minerals: 40, bonusBps: { gather: 300, carry: 400 } },
  weapon: { label: "Pebble Sling", fee: tokens(70_000), wood: 50, minerals: 80, bonusBps: { attack: 700 } },
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

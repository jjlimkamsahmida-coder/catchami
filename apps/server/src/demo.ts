/**
 * Demo marketplace (dev/test networks only): a few NPC sellers list pets of
 * every rarity so the marketplace isn't empty in a fresh build. Runs once
 * (guarded by a kv flag). Listed pets are real pets owned by the demo sellers,
 * so buying one goes through the normal marketplace transaction.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { generateGenome, randomSeedHex, tileCenter, tokens, type Rarity, type Species } from "@catchami/shared";
import type { Db } from "./db/index.ts";
import { env } from "./env.ts";
import { createGuest, newId } from "./auth.ts";
import { acct } from "./ledger/ledger.ts";
import { createListing } from "./services.ts";
import { freshPetState } from "./world/types.ts";
import type { Game } from "./world/game.ts";

const FLAG = "demo_market_v1";
const SELLERS = ["Mia the Collector", "Captain Whiskers", "Breeder Bea"];
const PETS: Array<{ name: string; species: Species; rarity: Rarity; price: number }> = [
  { name: "Mochi", species: "cat", rarity: "mythic", price: 480_000_000 },
  { name: "Biscuit", species: "dog", rarity: "legendary", price: 260_000_000 },
  { name: "Pumpkin", species: "cat", rarity: "epic", price: 120_000_000 },
  { name: "Noodle", species: "dog", rarity: "rare", price: 55_000_000 },
  { name: "Clover", species: "cat", rarity: "rare", price: 48_000_000 },
  { name: "Waffles", species: "dog", rarity: "uncommon", price: 22_000_000 },
  { name: "Tofu", species: "cat", rarity: "uncommon", price: 18_000_000 },
  { name: "Bean", species: "dog", rarity: "common", price: 9_000_000 },
];
const CAT_ART = ["demo-cat-face", "demo-cat-look", "demo-cat-joy", "demo-cat-wow"];

export async function seedDemoMarket(db: Db, game: Game) {
  if (env.network === "mainnet") return;
  const done = await db.query(`SELECT 1 FROM kv WHERE k = $1`, [FLAG]);
  if (done.rows.length) return;
  // Reuse real cut-out stickers from earlier catches where we have them.
  const real = await db.query<{ id: string; species: Species }>(`SELECT id, species FROM pets WHERE sticker LIKE '/media/stickers/%' ORDER BY created_at LIMIT 40`);
  const pool: Record<Species, string[]> = { cat: [], dog: [] };
  for (const r of real.rows) if (existsSync(join(env.mediaDir, "stickers", `${r.id}.png`))) pool[r.species].push(r.id);
  await mkdir(join(env.mediaDir, "stickers"), { recursive: true });

  const sellers: string[] = [];
  for (const name of SELLERS) {
    const g = await createGuest(db);
    await db.query(`UPDATE users SET display_name = $2, onboarding = '{"stage":"done"}' WHERE id = $1`, [g.userId, name]);
    sellers.push(g.userId);
  }
  const hq = game.world.pois.find((p) => p.id === "hq")!;
  let i = 0;
  for (const def of PETS) {
    const owner = sellers[i % sellers.length]!;
    const id = newId("pet");
    const genome = generateGenome(randomSeedHex(), id, def.species, def.rarity);
    let sticker: string;
    const src = pool[def.species][i % Math.max(1, pool[def.species].length)];
    if (src) { await copyFile(join(env.mediaDir, "stickers", `${src}.png`), join(env.mediaDir, "stickers", `${id}.png`)); sticker = `/media/stickers/${id}.png`; }
    else sticker = def.species === "cat" ? `/assets/gen/${CAT_ART[i % CAT_ART.length]}.png` : "";
    // Shop pets wait in a row in front of the market stalls.
    const state = freshPetState(tileCenter(hq.tx - 8 + (i % 8) * 2), tileCenter(hq.ty + 16), genome.stats);
    await db.query(`INSERT INTO accounts (id, kind, pet_id, user_id) VALUES ($1,'pet',$2,$3) ON CONFLICT DO NOTHING`, [acct.pet(id), id, owner]);
    await db.query(
      `INSERT INTO pets (id, owner_id, species, rarity, name, genome, sticker, mint_status, state) VALUES ($1,$2,$3,$4,$5,$6,$7,'awaiting_chain',$8)`,
      [id, owner, def.species, def.rarity, def.name, JSON.stringify({ ...genome, name: def.name }), sticker || null, JSON.stringify(state)],
    );
    await game.reloadPet(id);
    await createListing(db, game, owner, { petId: id }, tokens(def.price));
    i++;
  }
  await db.query(`INSERT INTO kv (k, v) VALUES ($1, $2) ON CONFLICT (k) DO NOTHING`, [FLAG, JSON.stringify({ at: Date.now(), sellers })]);
  console.log(`demo market: listed ${PETS.length} pets from ${SELLERS.length} sellers`);
}

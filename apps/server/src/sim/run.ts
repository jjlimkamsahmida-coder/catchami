/**
 * Economy simulation. Agent-based model of the live rules (same ECONOMY
 * config, same price/demand/treasury/battle/catch functions from
 * @catchami/shared) with an exact double-entry ledger and invariant checks.
 * Movement is abstracted into throughput limits taken from the real world
 * map (node counts and regrowth) and merchant capacity.
 *
 *   pnpm sim            -> docs/ECONOMY_SIMULATION.md + docs/simulation/index.html
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CATCH_TIERS, dailyBudget, ECONOMY, EQUIPMENT, generateGenome, generateWorld, HQ_ALLOCATION, HQ_RESERVE_FLOOR,
  initialDemand, merchantPrice, RESOURCES, rollCatch, Rng, simulateBattle, splitBps, tokens, TOTAL_SUPPLY,
  treasuryFactorBps, updateDemand, computeTheft, battleTakeBps, carryCapacity, formatTokens, type CatchTier, type Inventory, type Rarity, type Resource, type Stats,
} from "@catchami/shared";

type Archetype = "casual" | "grinder" | "whale" | "bot" | "dormant";
interface SimPet {
  id: number; owner: number; arche: Archetype; rarity: Rarity; stats: Stats;
  hunger: number; energy: number; hp: number; koUntil: number; inv: Inventory; target: Resource;
  gatheredToday: number; born: number; inactive: boolean; equip: number;
}
interface Scenario { name: string; pets: number; days: number; shardSize: number; newPlayersPerDay: number; inflowDecay: number; depositScale: number; note: string }

const STEP_S = 1800; // 30-minute steps
const STEPS_PER_DAY = 86400 / STEP_S;
const world = generateWorld();
const NODES: Record<Resource, number> = { fish: 0, herbs: 0, wood: 0, minerals: 0 };
for (const n of world.nodes) NODES[n.resource]++;

class Ledger {
  bal = new Map<string, bigint>();
  get(a: string) { return this.bal.get(a) ?? 0n; }
  move(from: string, to: string, amt: bigint): boolean {
    if (amt <= 0n) return amt === 0n;
    if (from !== "chain" && this.get(from) < amt) return false;
    this.bal.set(from, this.get(from) - amt);
    this.bal.set(to, this.get(to) + amt);
    return true;
  }
  split(from: string, amt: bigint, parts: Record<string, number>): boolean {
    if (from !== "chain" && this.get(from) < amt) return false;
    const s = splitBps(amt, parts, "hq");
    this.bal.set(from, this.get(from) - amt);
    for (const [k, v] of Object.entries(s)) this.bal.set(k, this.get(k) + v);
    return true;
  }
  sum() { let s = 0n; for (const v of this.bal.values()) s += v; return s; }
}

function runScenario(sc: Scenario, seed: string) {
  const rng = Rng.fromString(`${seed}:${sc.name}`);
  const L = new Ledger();
  L.move("chain", "hq", HQ_ALLOCATION);
  let demand = initialDemand(0);
  const stock: Inventory = { fish: 0, herbs: 0, wood: 0, minerals: 0 };
  const pets: SimPet[] = [];
  let owners = 0, nextPet = 0;
  const violations: string[] = [];
  const daily: Array<Record<string, number | string>> = [];
  let catchesOk = 0, catchesFail = 0;

  const archetypeFor = (): Archetype => { const r = rng.int(100); return r < 50 ? "casual" : r < 72 ? "grinder" : r < 77 ? "whale" : r < 85 ? "bot" : "dormant"; };
  const tierFor = (a: Archetype): CatchTier => (a === "whale" ? (rng.int(3) === 0 ? "premium" : "enhanced") : rng.int(100) < 75 ? "basic" : rng.int(5) === 0 ? "premium" : "enhanced");

  const onboard = (count: number, day: number) => {
    for (let i = 0; i < count; i++) {
      const owner = owners++;
      const arche = archetypeFor();
      const deposit = tokens(Math.round((arche === "whale" ? 60_000_000 : arche === "bot" ? 1_500_000 : 4_000_000) * sc.depositScale));
      L.move("chain", `user:${owner}`, deposit);
      const attempts = arche === "whale" ? 4 : arche === "bot" ? 1 : 2;
      for (let k = 0; k < attempts; k++) {
        const tier = tierFor(arche);
        const cost = ECONOMY.catch.tiers[tier].cost;
        if (L.get(`user:${owner}`) < cost) break;
        const roll = rollCatch(seed, `${sc.name}:${owner}:${k}`, tier);
        if (!roll.success) { L.move(`user:${owner}`, "hq", cost); catchesFail++; continue; }
        catchesOk++;
        const id = nextPet++;
        const s = splitBps(cost, ECONOMY.catch.successSplit, "hq");
        L.move(`user:${owner}`, `pet:${id}`, s.pet); L.move(`user:${owner}`, "hq", s.hq); L.move(`user:${owner}`, "team", s.team);
        const g = generateGenome(seed, `${sc.name}:p${id}`, rng.int(2) ? "cat" : "dog", roll.rarity!);
        pets.push({ id, owner, arche, rarity: g.rarity, stats: g.stats, hunger: 200, energy: g.stats.maxEnergy, hp: g.stats.maxHp, koUntil: 0, inv: { fish: 0, herbs: 0, wood: 0, minerals: 0 }, target: "fish", gatheredToday: 0, born: day, inactive: false, equip: 0 });
      }
    }
  };

  // Seed initial population so that ~sc.pets animals exist at day 0.
  while (pets.length < sc.pets) onboard(Math.max(1, Math.ceil((sc.pets - pets.length) / 1.6)), 0);

  for (let day = 0; day < sc.days; day++) {
    const budget = dailyBudget(L.get("hq"));
    const merchantAllowance = budget.merchants;
    let merchantSpent = 0n, foodSold = 0, medSold = 0, stockouts = 0, crafted = 0, battles = 0, withdrawn = 0n, saleUnits = 0;
    const incomeByPet = new Map<number, bigint>();
    if (day > 0) onboard(Math.round(sc.newPlayersPerDay * Math.pow(1 - sc.inflowDecay, day)), day);
    const shards = Math.max(1, Math.ceil(pets.length / sc.shardSize));
    for (const p of pets) p.gatheredToday = 0;

    for (let step = 0; step < STEPS_PER_DAY; step++) {
      const t = day * 86400 + step * STEP_S;
      const factor = treasuryFactorBps(L.get("hq"));
      const consumed: Inventory = { fish: 0, herbs: 0, wood: 0, minerals: 0 };
      const supplied: Inventory = { fish: 0, herbs: 0, wood: 0, minerals: 0 };
      // World throughput per shard per step (node regrowth), and merchant cart capacity.
      const supplyPerShard = Object.fromEntries(RESOURCES.map((r) => [r, NODES[r] * ECONOMY.gather.unitsPerHit * (STEP_S * 1000) / ECONOMY.resources[r].regenMs])) as Record<Resource, number>;
      const want: Record<Resource, number> = { fish: 0, herbs: 0, wood: 0, minerals: 0 };
      const best = [...RESOURCES].sort((a, b) => Number(merchantPrice(b, demand[b].indexBps, 10_000) / BigInt(ECONOMY.resources[b].weight) - merchantPrice(a, demand[a].indexBps, 10_000) / BigInt(ECONOMY.resources[a].weight)))[0]!;

      for (const p of pets) {
        if (p.koUntil > t) continue;
        const acct = `pet:${p.id}`;
        p.hunger = Math.min(1000, p.hunger + ECONOMY.stats.hungerPerSec * STEP_S);
        // Eat (autopilot buys as many meals as the step needs; each meal uses fishPerMeal real HQ fish).
        const fpm = ECONOMY.food.fishPerMeal;
        for (let k = 0; k < 6 && p.hunger >= 500; k++) {
          const local = stock.fish >= fpm;
          const price = local ? ECONOMY.food.price : (ECONOMY.food.price * BigInt(ECONOMY.food.importMultBps)) / 10_000n;
          if (L.split(acct, price, ECONOMY.food.split)) { consumed.fish += fpm; if (local) stock.fish -= fpm; else stockouts++; foodSold++; p.hunger -= ECONOMY.food.hungerRestore; p.energy = Math.min(p.stats.maxEnergy, p.energy + ECONOMY.food.energyRestore); }
          else break;
        }
        if (p.hunger >= 1000) p.energy = Math.max(0, p.energy - ECONOMY.stats.starvingEnergyDrainPerSec * STEP_S);
        p.inactive = p.energy <= 0 && p.hunger >= 1000;
        if (p.inactive) continue;
        // Heal.
        if (p.hp < p.stats.maxHp * 0.3 || (p.hp <= 0 && p.koUntil <= t)) {
          if (stock.herbs >= ECONOMY.medicine.herbsPerDose && L.split(acct, ECONOMY.medicine.price, ECONOMY.medicine.split)) { stock.herbs -= ECONOMY.medicine.herbsPerDose; consumed.herbs += ECONOMY.medicine.herbsPerDose; medSold++; p.hp = Math.min(p.stats.maxHp, Math.max(0, p.hp) + p.stats.maxHp * 0.4); }
        }
        if (p.hp <= 0) continue;
        // Work: dormant owners still run autopilot; effort by archetype.
        const effort = p.arche === "grinder" || p.arche === "bot" ? 0.75 : p.arche === "whale" ? 0.55 : 0.45;
        if (p.energy < 150) { p.energy = Math.min(p.stats.maxEnergy, p.energy + ECONOMY.stats.restEnergyPerSec * STEP_S * 0.8); continue; }
        p.target = rng.int(100) < 65 ? best : RESOURCES[rng.int(4)]!;
        const units = (STEP_S * effort * 1000) / (ECONOMY.resources[p.target].gatherMs * (100 / p.stats.gather)) * 0.35 * ECONOMY.gather.unitsPerHit; // 35%: walking, queuing, trading; each hit yields unitsPerHit
        want[p.target] += units;
        (p as SimPet & { want: number }).want = units;
        p.energy = Math.max(0, p.energy - units * ECONOMY.resources[p.target].energy - ECONOMY.stats.walkEnergyPerSec * STEP_S * 0.3);
      }
      // Allocate scarce node output across pets (shards multiply supply).
      for (const p of pets) {
        const w = (p as SimPet & { want?: number }).want;
        if (!w) continue;
        const share = Math.min(1, (supplyPerShard[p.target] * shards) / Math.max(1e-9, want[p.target]));
        const got = Math.floor(w * share + rng.float());
        const cap = Math.floor((carryCapacity(p.stats) - RESOURCES.reduce((s, r) => s + p.inv[r] * ECONOMY.resources[r].weight, 0)) / ECONOMY.resources[p.target].weight);
        const n = Math.max(0, Math.min(got, cap));
        p.inv[p.target] += n; p.gatheredToday += n;
        (p as SimPet & { want?: number }).want = 0;
      }
      // Merchants buy (cart capacity per shard per step and the daily allowance).
      const tripsPerStep = (STEP_S / 900) * ECONOMY.merchants.count * shards;
      let cartLeft = tripsPerStep * ECONOMY.merchants.inventoryCapacity;
      for (const p of pets) {
        if (cartLeft <= 0) break;
        const carried = RESOURCES.reduce((s, r) => s + p.inv[r] * ECONOMY.resources[r].weight, 0);
        if (carried < carryCapacity(p.stats) * 0.7) continue;
        for (const r of RESOURCES) {
          const keep = r === "fish" ? 1 : 0;
          let n = Math.max(0, p.inv[r] - keep);
          n = Math.min(n, Math.floor(cartLeft / ECONOMY.resources[r].weight));
          if (!n) continue;
          const price = merchantPrice(r, demand[r].indexBps, factor);
          let pay = price * BigInt(n);
          if (pay > merchantAllowance - merchantSpent) { n = Number((merchantAllowance - merchantSpent) / (price || 1n)); pay = price * BigInt(n); }
          if (n <= 0) continue;
          if (!L.move("hq", `pet:${p.id}`, pay)) { violations.push(`day ${day}: HQ could not cover a merchant payment`); continue; }
          merchantSpent += pay; incomeByPet.set(p.id, (incomeByPet.get(p.id) ?? 0n) + pay);
          p.inv[r] -= n; stock[r] += n; supplied[r] += n; saleUnits += n; cartLeft -= n * ECONOMY.resources[r].weight;
        }
      }
      // Crafting (grinders/whales) consumes real wood + minerals.
      for (const p of pets) {
        if ((p.arche !== "grinder" && p.arche !== "whale") || p.equip >= 2 || rng.int(200) !== 0) continue;
        const def = EQUIPMENT.boots;
        if (p.inv.wood >= def.wood && p.inv.minerals >= def.minerals && L.split(`pet:${p.id}`, def.fee, ECONOMY.equipment.craftSplit)) {
          p.inv.wood -= def.wood; p.inv.minerals -= def.minerals; consumed.wood += def.wood; consumed.minerals += def.minerals; p.equip++; crafted++;
          p.stats = { ...p.stats, speed: Math.floor(p.stats.speed * 1.06) };
        }
      }
      // Battles: whales and some grinders are aggressive.
      const fighters = pets.filter((p) => (p.arche === "whale" || (p.arche === "grinder" && p.id % 3 === 0)) && p.hp > p.stats.maxHp * 0.5 && p.koUntil <= t && !p.inactive);
      for (const a of fighters) {
        if (rng.int(100) >= 6) continue;
        const b = pets[rng.int(pets.length)]!;
        if (b === a || b.owner === a.owner || b.hp < b.stats.maxHp * 0.5 || b.inactive || b.koUntil > t) continue;
        const res = simulateBattle({ id: "a", stats: a.stats, hp: a.hp, energy: a.energy }, { id: "b", stats: b.stats, hp: b.hp, energy: b.energy }, seed, `${sc.name}:${day}:${step}:${a.id}:${b.id}`);
        battles++;
        a.hp = res.hp[0]; b.hp = res.hp[1]; a.energy = res.energy[0]; b.energy = res.energy[1];
        for (const p of [a, b]) if (p.hp <= 0) p.koUntil = t + ECONOMY.stats.knockoutCooldownSec;
        if (res.winner !== null) {
          const [w, l] = res.winner === 0 ? [a, b] : [b, a];
          const shareBps = battleTakeBps(w.stats.luck, l.stats.luck, rng.float());
          const take = computeTheft(l.inv, w.inv, carryCapacity(w.stats), shareBps);
          for (const r of RESOURCES) { l.inv[r] -= take[r]; w.inv[r] += take[r]; }
          // Coin spoils above the protected purse, minus the HQ/team fee.
          const st = ECONOMY.battle.stake, lb = L.get(`pet:${l.id}`);
          const coins = lb > st.protectedCoins ? ((lb - st.protectedCoins) * BigInt(shareBps)) / 10_000n : 0n;
          const fee = (coins * BigInt(st.feeBps)) / 10_000n;
          if (coins > 0n) { L.move(`pet:${l.id}`, `pet:${w.id}`, coins - fee); L.split(`pet:${l.id}`, fee, st.feeSplit); }
        }
      }
      for (const r of RESOURCES) demand[r] = updateDemand(demand[r], t * 1000, consumed[r], supplied[r]);
    }

    // Withdrawals.
    for (const p of pets) {
      const b = L.get(`pet:${p.id}`);
      const pull = p.arche === "whale" && day % 7 === 6 ? b / 10n : p.arche === "bot" && b > tokens(1_200_000) ? b - tokens(800_000) : 0n;
      if (pull > 0n) { L.move(`pet:${p.id}`, "chain", pull); withdrawn += pull; }
    }

    // Invariants.
    if (L.sum() !== 0n) violations.push(`day ${day}: ledger does not sum to zero`);
    for (const [k, v] of L.bal) if (k !== "chain" && v < 0n) violations.push(`day ${day}: ${k} negative`);
    if (-L.get("chain") > TOTAL_SUPPLY) violations.push(`day ${day}: claims exceed supply`);
    if (merchantSpent > merchantAllowance) violations.push(`day ${day}: merchants exceeded allowance`);
    if (L.get("hq") < HQ_RESERVE_FLOOR) violations.push(`day ${day}: HQ below reserve floor`);

    const balances = pets.map((p) => L.get(`pet:${p.id}`)).sort((a, b) => (a < b ? -1 : 1));
    const active = pets.filter((p) => !p.inactive && p.hp > 0);
    const incomes = active.map((p) => incomeByPet.get(p.id) ?? 0n).sort((a, b) => (a < b ? -1 : 1));
    const whole = (x: bigint) => Number(x / 10n ** 18n);
    daily.push({
      day, pets: pets.length, shards, activePct: Math.round((active.length / pets.length) * 1000) / 10,
      inactivePct: Math.round((pets.filter((p) => p.inactive).length / pets.length) * 1000) / 10,
      hq: whole(L.get("hq")), team: whole(L.get("team")), medianPet: whole(balances[Math.floor(balances.length / 2)] ?? 0n),
      medianIncome: whole(incomes[Math.floor(incomes.length / 2)] ?? 0n), merchantSpent: whole(merchantSpent), merchantAllowance: whole(merchantAllowance),
      foodSold, medSold, stockouts, crafted, battles, saleUnits, withdrawn: whole(withdrawn),
      fishIdx: demand.fish.indexBps, herbIdx: demand.herbs.indexBps, woodIdx: demand.wood.indexBps, minIdx: demand.minerals.indexBps,
    });
  }
  return { sc, daily, violations, catchesOk, catchesFail };
}

const SCENARIOS: Scenario[] = [
  { name: "100 animals, one world", pets: 100, days: 30, shardSize: 1e9, newPlayersPerDay: 5, inflowDecay: 0.02, depositScale: 1, note: "Baseline small launch." },
  { name: "1,000 animals, one world", pets: 1000, days: 30, shardSize: 1e9, newPlayersPerDay: 40, inflowDecay: 0.02, depositScale: 1, note: "Everyone shares one map's resource nodes." },
  { name: "1,000 animals, sharded 250/world", pets: 1000, days: 30, shardSize: 250, newPlayersPerDay: 40, inflowDecay: 0.02, depositScale: 1, note: "Same population split across world instances." },
  { name: "10,000 animals, sharded 250/world", pets: 10000, days: 30, shardSize: 250, newPlayersPerDay: 300, inflowDecay: 0.02, depositScale: 1, note: "Scale test." },
  { name: "10,000 animals, falling price + declining signups", pets: 10000, days: 30, shardSize: 250, newPlayersPerDay: 300, inflowDecay: 0.12, depositScale: 0.4, note: "Token price falls (smaller deposits) and new-player inflow decays 12%/day." },
];

const seed = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
const t0 = Date.now();
const results = SCENARIOS.map((s) => { const r = runScenario(s, seed); console.log(`${s.name}: ${r.violations.length} violations (${((Date.now() - t0) / 1000).toFixed(1)}s)`); return r; });

const fmtN = (n: number) => formatTokens(tokens(Math.round(n)));
let md = `# Catchami economy simulation\n\nGenerated by \`pnpm sim\` on ${new Date().toISOString()} with economy config \`${ECONOMY.version}\`.\n\n`;
md += `Model: 30-minute steps over 30 days. Same catch odds, splits, prices, demand index, treasury taper, battle engine as the live server. Resource output is capped by the real map (${Object.entries(NODES).map(([k, v]) => `${v} ${k} nodes`).join(", ")}) and merchant cart capacity. Money uses an exact double-entry ledger; invariants are checked every simulated day.\n\n`;
md += `Population mix: 50% casual, 22% grinders, 5% whales (bigger deposits, aggressive battles, weekly withdrawals), 8% bot-like farm accounts (minimum deposit, withdraw anything above 800K), 15% dormant owners (never return; autopilot keeps running).\n\n`;
md += `## Invariants\n\n| Scenario | Violations | Catches ok / failed |\n|---|---:|---:|\n`;
for (const r of results) md += `| ${r.sc.name} | ${r.violations.length ? "**" + r.violations.length + "** " + r.violations.slice(0, 2).join("; ") : "0"} | ${r.catchesOk} / ${r.catchesFail} |\n`;
md += `\nChecked daily: ledger sums to zero; no negative non-external account; claims never exceed 100T supply; merchant spend within the daily allowance; HQ never below its 5% reserve floor.\n\n`;
for (const r of results) {
  const first = r.daily[0]!, last = r.daily[r.daily.length - 1]!;
  md += `## ${r.sc.name}\n\n${r.sc.note}\n\n| Day | Pets | Worlds | Active % | Inactive % | Median pet balance | Median daily income (active) | Merchant spend / allowance | Meals | Stockouts | Battles |\n|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n`;
  for (const d of r.daily.filter((x, i) => i % 5 === 0 || i === r.daily.length - 1)) {
    md += `| ${d.day} | ${d.pets} | ${d.shards} | ${d.activePct} | ${d.inactivePct} | ${fmtN(d.medianPet as number)} | ${fmtN(d.medianIncome as number)} | ${fmtN(d.merchantSpent as number)} / ${fmtN(d.merchantAllowance as number)} | ${d.foodSold} | ${d.stockouts} | ${d.battles} |\n`;
  }
  md += `\nHQ ${fmtN(first.hq as number)} → ${fmtN(last.hq as number)}; team fee revenue ${fmtN(last.team as number)}.\n\n`;
}
md += `## Findings\n\nSee the narrative findings in docs/STATUS.md (Economy section). Numbers above are model outputs, not forecasts; they depend on the assumed player mix and do not include token market price effects beyond the deposit-scale scenario.\n`;

const outDir = join(import.meta.dirname, "..", "..", "..", "..", "docs");
await mkdir(join(outDir, "simulation"), { recursive: true });
await writeFile(join(outDir, "ECONOMY_SIMULATION.md"), md);
await writeFile(join(outDir, "simulation", "results.json"), JSON.stringify(results.map((r) => ({ scenario: r.sc, violations: r.violations, daily: r.daily })), null, 1));
await writeFile(join(outDir, "simulation", "index.html"), dashboardHtml(results.map((r) => ({ name: r.sc.name, daily: r.daily, violations: r.violations.length }))));
console.log("wrote docs/ECONOMY_SIMULATION.md and docs/simulation/index.html");

function dashboardHtml(data: Array<{ name: string; daily: Array<Record<string, number | string>>; violations: number }>) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Catchami economy simulation</title>
<style>:root{--ink:#2b1d3a;--paper:#fff6e5;--a:#ff7a59;--b:#3d9ef0;--c:#4fbf5a;--d:#a66bf2}body{margin:0;font-family:system-ui,sans-serif;background:var(--paper);color:var(--ink);padding:16px}h1{margin:0 0 4px}select{font:inherit;padding:6px;border:2px solid var(--ink);border-radius:8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:14px}.card{background:#fff;border:3px solid var(--ink);border-radius:14px;padding:10px}.card h3{margin:0 0 6px;font-size:15px}svg{width:100%;height:160px}.k{display:flex;gap:10px;font-size:12px;flex-wrap:wrap}.k i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:4px}</style></head><body>
<h1>Catchami economy simulation</h1><p>Model output from <code>pnpm sim</code> — not a forecast. <select id="s"></select> <span id="v"></span></p><div class="grid" id="g"></div>
<script>const D=${JSON.stringify(data)};
const charts=[["Active vs inactive pets (%)",["activePct","inactivePct"]],["HQ treasury (whole tokens)",["hq"]],["Median pet balance",["medianPet"]],["Median daily income of active pets",["medianIncome"]],["Merchant spend vs allowance",["merchantSpent","merchantAllowance"]],["Meals sold / stockout events",["foodSold","stockouts"]],["Demand index (bps)",["fishIdx","herbIdx","woodIdx","minIdx"]],["Battles per day",["battles"]]];
const C=["var(--a)","var(--b)","var(--c)","var(--d)"];const s=document.getElementById("s");D.forEach((d,i)=>s.add(new Option(d.name,i)));
function line(rows,keys){const W=300,H=150,P=6;let max=0,min=Infinity;keys.forEach(k=>rows.forEach(r=>{max=Math.max(max,+r[k]);min=Math.min(min,+r[k])}));min=Math.min(min,0);const sx=i=>P+i*(W-2*P)/Math.max(1,rows.length-1),sy=v=>H-P-(v-min)*(H-2*P)/Math.max(1e-9,max-min);return '<svg viewBox="0 0 '+W+' '+H+'">'+keys.map((k,j)=>'<polyline fill="none" stroke="'+C[j]+'" stroke-width="2.5" points="'+rows.map((r,i)=>sx(i)+","+sy(+r[k])).join(" ")+'"/>').join("")+'<text x="4" y="12" font-size="10">'+Math.round(max).toLocaleString()+'</text></svg><div class="k">'+keys.map((k,j)=>'<span><i style="background:'+C[j]+'"></i>'+k+'</span>').join("")+'</div>'}
function draw(){const d=D[s.value];document.getElementById("v").textContent=d.violations?"⚠ "+d.violations+" invariant violations":"All invariants held";document.getElementById("g").innerHTML=charts.map(([t,k])=>'<div class="card"><h3>'+t+'</h3>'+line(d.daily,k)+'</div>').join("")}s.onchange=draw;draw();</script></body></html>`;
}

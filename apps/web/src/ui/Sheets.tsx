import { AREA_BOUNDS, ECONOMY, nodeStock, RESOURCE_LABEL, RESOURCES, inventoryWeight, shopPrice, type Resource, toWire } from "@catchami/shared";
import { useEffect, useState } from "react";
import { CraftPanel } from "./Pets.tsx";
import { controlledPet, entities, store, useStore } from "../net/store.ts";
import { rid, send } from "../net/api.ts";
import { fmt, fmtQty, PetArt, RarityTag, ResIcon, Sheet } from "./common.tsx";
import { banditArt, genUrl, MERCHANT_ART } from "../game/assets.ts";

const close = () => store.set({ sheet: null });

export function Sheets() {
  const sheet = useStore((s) => s.sheet);
  if (!sheet) return null;
  if (sheet.kind === "merchant") return <MerchantSheet id={sheet.id} />;
  if (sheet.kind === "bandit") return <BanditSheet id={sheet.id} />;
  if (sheet.kind === "pet") return <PetSheet id={sheet.id} />;
  return <NodeSheet id={sheet.id} />;
}

function BanditSheet({ id }: { id: string }) {
  const b = useStore((s) => s.bandits.find((x) => x[0] === id));
  const p = useStore(controlledPet);
  if (!b) return null;
  const [, bx, by, st, , name] = b;
  const e = p ? entities.get(p.id)?.samples.at(-1) : null;
  const dist = e ? Math.hypot(e[1] - bx, e[2] - by) : Infinity;
  const near = dist <= 140;
  return (
    <Sheet onClose={close}>
      <div className="col" style={{ gap: 10, alignItems: "center", textAlign: "center" }}>
        <span className="bandit-badge"><img src={genUrl(banditArt(id).key)} alt="" /></span>
        <h2 style={{ margin: 0 }}>{name}</h2>
        <p className="small" style={{ margin: 0 }}>{id === "bandit-practice" ? "A friendly sparring partner. Practise battles here — no loot at stake!" : st === 1 ? "Coming to challenge you!" : st === 2 ? "Heading off…" : "Another Keeper's pet, out looking for a battle."}</p>
        {id !== "bandit-practice" && <p className="small muted" style={{ margin: 0 }}>Win the battle to keep your loot. Lose and the winner takes everything in your bag. Challenging first gives you a better chance!</p>}
        <button className="game-btn start sm" disabled={!p || !near || st === 2} onClick={() => { if (p) send({ t: "fight_bandit", petId: p.id, banditId: id }); close(); }}>
          <span className="gb-label">{!p ? "Catch a pet first" : st === 2 ? "It's running away" : near ? "⚔️ Battle!" : "Get closer to battle"}</span>
        </button>
      </div>
    </Sheet>
  );
}

function MerchantSheet({ id }: { id: string }) {
  const m = useStore((s) => s.merchants.find((x) => x.id === id));
  const det = useStore((s) => s.merchantDetail[id]);
  const p = useStore(controlledPet);
  const tut = useStore((s) => s.onboarding?.stage === "tutorial");
  const ticker = useStore((s) => s.ticker);
  const gearOk = !tut || id === "smith";
  const [tab, setTab] = useState<"shop" | "gear">(id === "smith" ? "gear" : "shop");
  // Talking to a merchant: they wait for you while the shop is open.
  useEffect(() => { send({ t: "talk", merchantId: id }); const t = setInterval(() => send({ t: "talk", merchantId: id }), 2_000); return () => clearInterval(t); }, [id]);
  if (!m) return null;
  const meal = shopPrice("food", ticker?.hqStock.fish ?? 0), med = shopPrice("medicine", ticker?.hqStock.herbs ?? 0);
  const fresh = det && Date.now() - det.at < 2500;
  const open = m.state !== "at_hq" && m.state !== "unavailable";
  const sell = (items: Partial<Record<Resource, number>>) => p && send({ t: "sell", petId: p.id, merchantId: id, items });
  const total = p && det ? RESOURCES.reduce((s, r) => s + BigInt(det.detail.prices[r]) * BigInt(p.carried[r]), 0n) : 0n;
  const mealPrice = tut ? ECONOMY.food.price : meal.price, medPrice = tut ? ECONOMY.medicine.price : med.price;
  return (
    <Sheet onClose={close}>
      <div className="mshop">
        <div className="mshop-head">
          <span className="mshop-art"><img src={genUrl(MERCHANT_ART[id] ?? "merchant-finn")} alt="" /></span>
          <div className="mshop-who">
            <h2>{m.name}</h2>
            {open && fresh && det
              ? <span className="mshop-chips"><span>💰 {fmt(det.detail.cash)}</span><span>🛒 room {fmtQty(det.detail.capacityLeft)}</span></span>
              : <span className="mshop-chips"><span>{m.state === "at_hq" ? "🏰 restocking at HQ" : m.state === "unavailable" ? "😴 closed today" : "👋 come closer"}</span></span>}
          </div>
        </div>
        {!open && <div className="notice">{m.state === "unavailable" ? "HQ couldn't fund this merchant's next trip within today's budget. They'll head out again when funds allow." : "Back at HQ delivering goods and collecting the next budget."}</div>}
        {open && !fresh && (
          <div className="notice">
            Walk {p ? p.name : "your pet"} next to {m.name.split(" ")[0]} to trade.
            <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => { send({ t: "goto", x: m.x, y: m.y }); close(); }}>Walk there</button></div>
          </div>
        )}
        {open && fresh && det && (
          <>
            {gearOk && (
              <div className="mshop-tabs">
                <button className={tab === "shop" ? "on" : ""} onClick={() => setTab("shop")}>🛒 Shop</button>
                <button className={tab === "gear" ? "on" : ""} onClick={() => setTab("gear")}>🛠️ Gear</button>
              </div>
            )}
            {(tab === "shop" || !gearOk) && (
              <>
                <h4 className="mshop-h">Sell your loot</h4>
                <div className="mshop-sell">
                  {RESOURCES.map((r) => {
                    const have = p?.carried[r] ?? 0;
                    return (
                      <div key={r} className={`mshop-res ${have ? "" : "none"}`}>
                        <ResIcon r={r} size={38} />
                        <b>{RESOURCE_LABEL[r]}</b>
                        <small>🪙 {fmt(det.detail.prices[r])} each</small>
                        <button className="mshop-mini" disabled={!p || !have} onClick={() => sell({ [r]: have })}>Sell {fmtQty(have)}</button>
                      </div>
                    );
                  })}
                </div>
                <button className="mshop-big sell" disabled={!p || inventoryWeight(p.carried) === 0} onClick={() => sell(p!.carried)}>
                  <b>💰 Sell everything</b>{total > 0n && <small>+{fmt(total)}</small>}
                </button>
                <h4 className="mshop-h">Food &amp; care</h4>
                <div className="mshop-items">
                  <div className="mshop-item meal">
                    <span className="mshop-emoji">🍖</span>
                    <b>{!tut && meal.imported ? "Imported meal" : "Meal"}</b>
                    <small>−350 hunger · +220 energy</small>
                    <button className="mshop-buy" disabled={!p || p.hunger < 50} onClick={() => p && send({ t: "buy", petId: p.id, item: "food", rid: rid() })}>Buy meal · {fmt(mealPrice)}</button>
                  </div>
                  <div className="mshop-item med">
                    <span className="mshop-emoji">💊</span>
                    <b>{!tut && med.imported ? "Imported medicine" : "Medicine"}</b>
                    <small>+40% HP · wakes a 0-HP pet</small>
                    <button className="mshop-buy" disabled={!p || (!tut && p.status !== "knocked_out" && p.hp >= p.stats.maxHp)} onClick={() => p && send({ t: "buy", petId: p.id, item: "medicine", rid: rid() })}>Buy Medicine · {fmt(medPrice)}</button>
                  </div>
                </div>
                <p className="mshop-fine">Prices follow live demand. Merchants pay from their own purse and stop buying when cash or cart space runs out.</p>
              </>
            )}
            {gearOk && tab === "gear" && p && <CraftPanel p={p} />}
          </>
        )}
      </div>
    </Sheet>
  );
}

function PetSheet({ id }: { id: string }) {
  const userId = useStore((s) => s.userId);
  const controlled = useStore(controlledPet);
  const e = entities.get(id);
  const meta = e?.meta;
  if (!meta) return null;
  const mine = meta.ownerId === userId;
  const last = e!.samples.at(-1);
  const cl = controlled ? entities.get(controlled.id)?.samples.at(-1) : null;
  const dist = last && cl ? Math.hypot(last[1] - cl[1], last[2] - cl[2]) : Infinity;
  // Paw Village is a safe zone (the server enforces this too).
  const inVillage = (px?: number) => px !== undefined && px / 32 >= AREA_BOUNDS.village[0] && px / 32 < AREA_BOUNDS.village[2];
  const safe = inVillage(cl?.[1]) || inVillage(last?.[1]);
  return (
    <Sheet onClose={close}>
      <div className="row" style={{ gap: 14, alignItems: "flex-start" }}>
        <div style={{ width: 96, height: 96, flex: "none" }}><PetArt sticker={meta.sticker} species={meta.species} look={meta.look} /></div>
        <div className="col grow" style={{ gap: 6 }}>
          <div className="row"><h2>{meta.name}</h2><RarityTag r={meta.rarity} /></div>
          <span className="small muted">{meta.species} · owned by {mine ? "you" : meta.ownerName} · {meta.status.replace("_", " ")}</span>
          <dl className="kv">
            <dt>Token balance</dt><dd className="num">{fmt(meta.balance)}</dd>
            <dt>Carrying</dt><dd>{RESOURCES.filter((r) => meta.carried[r]).map((r) => <span key={r} style={{ marginLeft: 6 }}><ResIcon r={r} size={16} />{meta.carried[r]}</span>)}{!inventoryWeight(meta.carried) && "nothing"}</dd>
          </dl>
        </div>
      </div>
      <div className="col" style={{ marginTop: 12 }}>
        {mine ? (
          <button className="btn block" onClick={() => { send({ t: "select", petId: id }); store.set({ controlled: id, sheet: null }); }}>{controlled?.id === id ? "You're controlling this pet" : "Control this pet"}</button>
        ) : (
          <>
            <button className="btn coral block" disabled={!controlled || safe || dist > ECONOMY.battle.challengeRangePx} onClick={() => { send({ t: "br_challenge", petId: controlled!.id, targetId: id }); close(); }}>
              {!controlled ? "Catch a pet first" : safe ? "No battles in Paw Village" : dist > ECONOMY.battle.challengeRangePx ? "Get closer to challenge" : `Bubble Roulette with ${controlled.name}`}
            </button>
            <p className="small muted" style={{ margin: 0 }}>Bubble Roulette is a live turn-based match — the other owner must be online and accept. HP is the score; a splash costs 20.</p>
            <p className="small muted" style={{ margin: 0 }}>
              The winner takes {ECONOMY.battle.stake.minShareBps / 100}–{ECONOMY.battle.stake.maxShareBps / 100}% of the loser's coins (the first {fmt(toWire(ECONOMY.battle.stake.protectedCoins))} are always safe) and bag — luck decides how much. A match costs {ECONOMY.battle.matchEnergy} energy, {ECONOMY.battle.matchHunger} hunger, and the loser is knocked out.
            </p>
          </>
        )}
      </div>
    </Sheet>
  );
}

function NodeSheet({ id }: { id: string }) {
  const n = useStore((s) => s.nodesDef.find((x) => x.id === id));
  const rem = useStore((s) => s.nodes[id]);
  const p = useStore(controlledPet);
  if (!n) return null;
  const cfg = ECONOMY.resources[n.resource];
  return (
    <Sheet onClose={close}>
      <div className="col" style={{ gap: 10 }}>
        <div className="row"><ResIcon r={n.resource} size={34} /><h2>{RESOURCE_LABEL[n.resource]} spot</h2></div>
        <dl className="kv">
          <dt>Available now</dt><dd>{rem === undefined ? "get closer to see" : rem <= 0 ? "picked clean — regrowing" : `${fmtQty(rem)} of ${fmtQty(nodeStock(n.id))}`}</dd>
          <dt>Weight per unit</dt><dd>{cfg.weight}</dd>
          <dt>Used for</dt><dd>{{ fish: "food", herbs: "medicine", wood: "crafting", minerals: "crafting" }[n.resource]}</dd>
        </dl>
        <button className="btn block" disabled={!p || p.status === "knocked_out"} title={p?.status === "knocked_out" ? "0 HP — buy medicine first" : ""} onClick={() => { send({ t: "gather", petId: p!.id, nodeId: id }); close(); }}>
          {p ? `Send ${p.name} to gather` : "Catch a pet first"}
        </button>
      </div>
    </Sheet>
  );
}

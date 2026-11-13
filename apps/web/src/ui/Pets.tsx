import { Fragment, useState } from "react";
import {
  ECONOMY, EQUIPMENT, EQUIPMENT_KINDS, RESOURCES, STAT_KEYS, TRAITS, formatTokens, parseTokens,
  type OwnPet, type Strategy, type EquipmentKind,
} from "@catchami/shared";
import { store, useStore } from "../net/store.ts";
import { api, refreshWallet, rid, send } from "../net/api.ts";
import { toast } from "../net/store.ts";
import { fmt, PetArt, RarityTag, ResIcon, ScreenHead, useAsync } from "./common.tsx";
import { CollectorCard, cardFromPet } from "./CollectorCard.tsx";

export function PetsScreen() {
  const own = useStore((s) => s.own);
  const petScreen = useStore((s) => s.petScreen);
  const pet = own.find((p) => p.id === petScreen);
  if (pet) return <PetDetail p={pet} />;
  return (
    <div className="screen">
      <ScreenHead title="Your pets" right={<button className="btn coral sm" onClick={() => store.set({ screen: "catch" })}>Catch</button>} />
      {!own.length && <div className="empty card">No pets yet. Point your camera at a real cat or dog to catch your first one.</div>}
      <div className="grid-cards">
        {own.map((p) => (
          <button key={p.id} className="card petgrid-item" onClick={() => store.set({ petScreen: p.id })}>
            <div className="art"><PetArt sticker={p.sticker} species={p.species} look={p.look} /></div>
            <div className="row"><b className="grow">{p.name}</b><RarityTag r={p.rarity} /></div>
            <div className="row small"><span className="muted grow">{p.status.replace("_", " ")}</span><b className="num">{fmt(p.balance)}</b></div>
          </button>
        ))}
      </div>
    </div>
  );
}

type Tab = "status" | "strategy" | "wallet" | "gear";

function PetDetail({ p }: { p: OwnPet }) {
  const [tab, setTab] = useState<Tab>("status");
  return (
    <div className="screen">
      <ScreenHead title={p.name} onBack={() => store.set({ petScreen: null })} right={<RarityTag r={p.rarity} />} />
      <div className="row" style={{ gap: 14, marginBottom: 12 }}>
        <div style={{ width: 110, height: 110, flex: "none" }}><PetArt sticker={p.sticker} species={p.species} look={p.look} /></div>
        <div className="col grow" style={{ gap: 4 }}>
          <span className="muted small">{p.species} · {p.activity}</span>
          <div className="row"><span className="muted">Balance</span><b className="right num" style={{ fontSize: 20 }}>{fmt(p.balance)}</b></div>
          {p.held !== "0" && <div className="row small"><span className="muted">Committed</span><span className="right num">{fmt(p.held)}</span></div>}
          <div className="row small"><span className="muted">NFT</span><span className="right">{p.mintStatus === "minted" ? p.nftTokenId : p.mintStatus === "awaiting_chain" ? "mint queued" : "mint pending"}</span></div>
          <button className="btn sm" onClick={() => { send({ t: "select", petId: p.id }); store.set({ controlled: p.id, screen: "world", petScreen: null }); }}>Control in world</button>
        </div>
      </div>
      <div className="seg" style={{ marginBottom: 12 }}>
        {(["status", "strategy", "wallet", "gear"] as Tab[]).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)} style={{ textTransform: "capitalize" }}>{t}</button>)}
      </div>
      {tab === "status" && <StatusTab p={p} />}
      {tab === "strategy" && <StrategyTab p={p} />}
      {tab === "wallet" && <WalletTab p={p} />}
      {tab === "gear" && <GearTab p={p} />}
    </div>
  );
}

function StatusTab({ p }: { p: OwnPet }) {
  const label: Record<string, string> = { maxHp: "Max HP", maxEnergy: "Max energy", attack: "Attack", defense: "Defense", gather: "Gathering", speed: "Speed", luck: "Luck", carry: "Carry capacity" };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div style={{ display: "grid", placeItems: "center", padding: "6px 0 10px" }}>
        <CollectorCard card={cardFromPet(p)} width={Math.min(290, window.innerWidth - 60)} />
      </div>
      <div className="card">
        <dl className="kv">
          <dt>HP</dt><dd className="num">{p.hp} / {p.stats.maxHp}</dd>
          <dt>Energy</dt><dd className="num">{p.energy} / {p.stats.maxEnergy}</dd>
          <dt>Hunger</dt><dd className="num">{p.hunger} / {ECONOMY.stats.hungerMax}</dd>
          <dt>Gathered today</dt><dd className="num">{p.gatheredToday}</dd>
          <dt>Battles</dt><dd className="num">{p.wins}W · {p.losses}L</dd>
          {p.koUntil && <><dt>Knocked out until</dt><dd>{new Date(p.koUntil).toLocaleTimeString()}</dd></>}
        </dl>
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 6 }}>Attributes <span className="small muted">(only you can see these)</span></h3>
        <dl className="kv">
          {STAT_KEYS.map((k) => (
            <Fragment key={k}><dt>{label[k]}</dt><dd className="num">{p.stats[k]}{p.stats[k] !== p.baseStats[k] && <span className="small muted"> (base {p.baseStats[k]})</span>}</dd></Fragment>
          ))}
        </dl>
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
          {p.traits.map((t) => <span key={t} className="tag">{TRAITS.find((x) => x.id === t)?.label ?? t}</span>)}
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 6 }}>Carrying</h3>
        <div className="inv" style={{ fontSize: 16 }}>{RESOURCES.map((r) => <span key={r}><ResIcon r={r} size={22} /> {p.carried[r]}</span>)}</div>
      </div>
      <HistoryCard petId={p.id} />
    </div>
  );
}

function HistoryCard({ petId }: { petId: string }) {
  const h = useAsync(() => api(`/api/pets/${petId}/history`), [petId]);
  return (
    <div className="card">
      <div className="row"><h3 className="grow">Recent earnings & expenses</h3><button className="btn sm paper" onClick={h.reload}>Refresh</button></div>
      {h.loading && <p className="muted small">Loading…</p>}
      {h.data?.history?.length === 0 && <p className="muted small">Nothing yet.</p>}
      <table className="lb"><tbody>
        {h.data?.history?.map((x: { kind: string; amount: string; created_at: string }, i: number) => (
          <tr key={i}><td style={{ width: "auto", fontWeight: 600 }}>{x.kind.replace(/_/g, " ")}</td><td className="muted small">{new Date(x.created_at).toLocaleString()}</td><td className="num" style={{ textAlign: "right", color: x.amount.startsWith("-") ? "var(--bad)" : "var(--good)", fontWeight: 700 }}>{x.amount.startsWith("-") ? "−" : "+"}{fmt(x.amount.replace("-", ""))}</td></tr>
        ))}
      </tbody></table>
    </div>
  );
}

export function StrategyTab({ p }: { p: OwnPet }) {
  const [s, setS] = useState<Strategy>(p.strategy);
  const set = <K extends keyof Strategy>(k: K, v: Strategy[K]) => setS((x) => ({ ...x, [k]: v }));
  const seg = <K extends keyof Strategy>(k: K, opts: Array<[Strategy[K], string]>) => (
    <div className="seg">{opts.map(([v, l]) => <button key={String(v)} className={s[k] === v ? "on" : ""} onClick={() => set(k, v)}>{l}</button>)}</div>
  );
  const save = () => { send({ t: "strategy", petId: p.id, strategy: s }); toast("good", `${p.name}'s strategy saved`); };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card col">
        <div className="row"><h3 className="grow">Autopilot</h3>{seg("auto", [[true, "On"], [false, "Off"]])}</div>
        <p className="small muted" style={{ margin: 0 }}>Autopilot keeps working while you're offline using only the rules below. Moving the pet yourself pauses it for 45 seconds.</p>
      </div>
      <div className="card col">
        <h3>Work</h3>
        <span className="small muted">Effort</span>{seg("work", [["low", "Low"], ["balanced", "Balanced"], ["high", "High"]])}
        <span className="small muted">Gather</span>{seg("resource", [["demand", "Highest demand"], ["fish", "Fish"], ["herbs", "Herbs"], ["wood", "Wood"], ["minerals", "Stone"]])}
        <span className="small muted">Selling</span>{seg("sell", [["immediate", "Sell often"], ["full", "When full"], ["best_price", "Best-paying merchant"], ["nearest", "Nearest merchant"], ["hold", "Hold selected"]])}
        <span className="small muted">Never sell</span>
        <div className="seg">{RESOURCES.map((r) => <button key={r} className={s.hold.includes(r) ? "on" : ""} onClick={() => set("hold", s.hold.includes(r) ? s.hold.filter((x) => x !== r) : [...s.hold, r])}><ResIcon r={r} size={14} /> {r}</button>)}</div>
      </div>
      <div className="card col">
        <h3>Battles</h3>
        {seg("battle", [["balanced", "Accept challenges"], ["avoid", "Avoid battles"]])}
        <label className="field">Fight only above {Math.round(s.minHpBps / 100)}% HP<input type="range" min={1000} max={10000} step={500} value={s.minHpBps} onChange={(e) => set("minHpBps", Number(e.target.value))} /></label>
        <label className="field">Head to a merchant once carrying {Math.round(s.maxCarryRiskBps / 100)}% of capacity (theft exposure)<input type="range" min={1000} max={10000} step={500} value={s.maxCarryRiskBps} onChange={(e) => set("maxCarryRiskBps", Number(e.target.value))} /></label>
      </div>
      <div className="card col">
        <h3>Survival</h3>
        <label className="field">Eat when hunger reaches {s.eatAtHunger}<input type="range" min={200} max={950} step={50} value={s.eatAtHunger} onChange={(e) => set("eatAtHunger", Number(e.target.value))} /></label>
        <label className="field">Keep {s.foodReserve} fish as emergency food<input type="range" min={0} max={10} value={s.foodReserve} onChange={(e) => set("foodReserve", Number(e.target.value))} /></label>
        <label className="field">Rest below {s.restBelowEnergy} energy<input type="range" min={0} max={600} step={25} value={s.restBelowEnergy} onChange={(e) => set("restBelowEnergy", Number(e.target.value))} /></label>
        <div className="row"><span className="grow">Buy medicine when needed</span>{seg("buyMedicine", [[true, "Yes"], [false, "No"]])}</div>
      </div>
      <button className="btn leaf block" onClick={save}>Save strategy</button>
    </div>
  );
}

export function WalletTab({ p }: { p: OwnPet }) {
  const wallet = useStore((s) => s.wallet);
  const [amt, setAmt] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (kind: "fund" | "withdraw") => {
    setBusy(true);
    try {
      parseTokens(amt);
      await api(`/api/pets/${p.id}/${kind}`, { amount: amt, rid: rid() });
      toast("good", kind === "fund" ? `Added ${amt} to ${p.name}` : `Moved ${amt} to your wallet`);
      setAmt("");
      await refreshWallet();
    } catch (e) { toast("bad", (e as Error).message); } finally { setBusy(false); }
  };
  const listing = useAsync(() => api(`/api/market?kind=animal`), [p.listed]);
  const myListing = listing.data?.listings?.find((l: { pet_id: string }) => l.pet_id === p.id);
  const [price, setPrice] = useState("");
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card col">
        <dl className="kv">
          <dt>Pet balance</dt><dd className="num">{fmt(p.balance)}</dd>
          <dt>Available to withdraw</dt><dd className="num">{fmt(p.available)}</dd>
          <dt>Your wallet</dt><dd className="num">{fmt(wallet?.available)}</dd>
        </dl>
        <label className="field">Amount (whole $CATCHAMI)<input type="text" inputMode="decimal" value={amt} placeholder="e.g. 50000" onChange={(e) => setAmt(e.target.value.replace(/[^\d.]/g, ""))} /></label>
        <div className="row">
          <button className="btn leaf grow" disabled={busy || !amt} onClick={() => act("fund")}>Add to pet</button>
          <button className="btn paper grow" disabled={busy || !amt || p.listed} onClick={() => act("withdraw")}>Withdraw to wallet</button>
        </div>
        {p.listed && <p className="small muted" style={{ margin: 0 }}>Withdrawals are locked while {p.name} is listed — buyers rely on the shown balance.</p>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Want to sell {p.name}? Use the 🛒 Market — the piggy bank goes with the pet.</p>
    </div>
  );
}

export function GearTab({ p }: { p: OwnPet }) {
  const gear = useAsync(() => api(`/api/equipment`), []);
  const equip = async (id: string, petId: string | null) => {
    try { await api(`/api/equipment/${id}/equip`, { petId }); gear.reload(); } catch (e) { toast("bad", (e as Error).message); }
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card col">
        <h3>Equipment ({p.equipment.length}/{ECONOMY.equipment.slots} slots)</h3>
        {gear.data?.items?.length === 0 && <p className="muted small" style={{ margin: 0 }}>No equipment yet.</p>}
        {gear.data?.items?.map((it: { id: string; kind: EquipmentKind; rarity: string; pet_id: string | null; equipped: boolean }) => (
          <div key={it.id} className="row">
            <span className={`tag rarity ${it.rarity}`}>{it.rarity}</span>
            <span className="grow">{EQUIPMENT[it.kind].label}</span>
            {it.pet_id === p.id ? <button className="btn sm paper" onClick={() => equip(it.id, null)}>Unequip</button>
              : it.pet_id ? <span className="small muted">on another pet</span>
              : <button className="btn sm" onClick={() => equip(it.id, p.id)}>Equip</button>}
          </div>
        ))}
      </div>
      <div className="notice">🛠️ Gear is crafted at merchants: walk up to any merchant, tap <b>Open shop</b> and pick <b>Craft gear</b>.</div>
    </div>
  );
}

/** Crafting bench, shown inside a merchant's shop. */
export function CraftPanel({ p }: { p: OwnPet }) {
  const recipes = useAsync(() => api(`/api/craft`), []);
  const [busy, setBusy] = useState(false);
  const craft = async (kind: EquipmentKind, buyMissing: boolean) => {
    setBusy(true);
    try {
      const r = await api(`/api/pets/${p.id}/craft`, { kind, buyMissing, rid: rid() });
      toast("good", `Crafted ${r.rarity} ${EQUIPMENT[kind].label} for ${fmt(r.fee)}`);
      recipes.reload();
    } catch (e) { toast("bad", (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <p className="small muted" style={{ margin: 0 }}>Uses wood and stone from {p.name}'s bag first; missing materials can be bought from HQ's stock. The fee is paid from {p.name}'s piggy bank.</p>
      {recipes.data?.recipes?.map((r: { kind: EquipmentKind; label: string; fee: string; wood: number; minerals: number; bonusBps: Record<string, number>; hqStock: { wood: number; minerals: number }; hqUnitPrice: { wood: string; minerals: string } }) => {
        const needW = Math.max(0, r.wood - p.carried.wood), needM = Math.max(0, r.minerals - p.carried.minerals);
        const canBuy = needW <= r.hqStock.wood && needM <= r.hqStock.minerals;
        const extra = BigInt(r.hqUnitPrice.wood) * BigInt(needW) + BigInt(r.hqUnitPrice.minerals) * BigInt(needM);
        return (
          <div key={r.kind} className="col" style={{ gap: 4, borderTop: "2px dashed var(--paper-3)", paddingTop: 8 }}>
            <div className="row"><b className="grow">{r.label}</b><span className="small">{Object.entries(r.bonusBps).map(([k, v]) => `${v > 0 ? "+" : ""}${v / 100}% ${k}`).join(", ")}</span></div>
            <div className="row small"><ResIcon r="wood" size={16} /> {r.wood} <ResIcon r="minerals" size={16} /> {r.minerals} <span className="muted">+ {fmt(r.fee)} fee</span></div>
            <div className="row">
              <button className="btn sm grow" disabled={busy || needW > 0 || needM > 0} onClick={() => craft(r.kind, false)}>Craft from bag</button>
              <button className="btn sm paper grow" disabled={busy || (!needW && !needM) || !canBuy} title={!canBuy ? "HQ doesn't have enough real stock" : ""} onClick={() => craft(r.kind, true)}>
                {needW || needM ? (canBuy ? `Buy missing · ${fmt(extra)}` : "HQ stock too low") : "Have materials"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { EQUIPMENT_KINDS };

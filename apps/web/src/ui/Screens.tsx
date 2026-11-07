import { useState } from "react";
import { commitmentOf, RARITIES, rollCatch, toDecimalString, type CatchTier } from "@catchami/shared";
import { store, toast, useStore } from "../net/store.ts";
import { api, refreshWallet, signOut } from "../net/api.ts";
import { fmt, Icon, PetArt, RarityTag, ScreenHead, useAsync } from "./common.tsx";

export function MarketScreen() {
  const [kind, setKind] = useState<"animal" | "equipment">("animal");
  const [rarity, setRarity] = useState<string>("");
  const [species, setSpecies] = useState<string>("");
  const userId = useStore((s) => s.userId);
  const q = new URLSearchParams({ kind, ...(rarity ? { rarity } : {}), ...(species ? { species } : {}) });
  const list = useAsync(() => api(`/api/market?${q}`), [q.toString()]);
  const buy = async (l: Listing) => {
    const ok = confirm(`Buy ${l.name ?? l.kind} for ${fmt(l.price)}?${l.pet_id ? `\nAttached pet balance: ${fmt(l.pet_balance)} (transfers to you).` : ""}\nA 2% fee is paid by the seller.`);
    if (!ok) return;
    try {
      await api(`/api/market/${l.id}/buy`, { expectedPetBalance: l.pet_id ? l.pet_balance : null });
      toast("good", "Purchased! It's in your collection.");
      list.reload();
      await refreshWallet();
    } catch (e) { toast("bad", (e as Error).message); list.reload(); }
  };
  return (
    <div className="screen">
      <ScreenHead title="Marketplace" />
      <div className="seg" style={{ marginBottom: 8 }}>
        <button className={kind === "animal" ? "on" : ""} onClick={() => setKind("animal")}>Animals</button>
        <button className={kind === "equipment" ? "on" : ""} onClick={() => setKind("equipment")}>Equipment</button>
      </div>
      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <select className="btn paper sm" value={rarity} onChange={(e) => setRarity(e.target.value)}><option value="">Any rarity</option>{RARITIES.map((r) => <option key={r} value={r}>{r}</option>)}</select>
        {kind === "animal" && <select className="btn paper sm" value={species} onChange={(e) => setSpecies(e.target.value)}><option value="">Any species</option><option value="cat">Cats</option><option value="dog">Dogs</option></select>}
      </div>
      {list.loading && <p className="muted">Loading…</p>}
      {list.error && <div className="notice warn">{list.error}</div>}
      {list.data && !list.data.listings.length && <div className="empty card">No listings yet. Listings appear here only when real players put an animal or item up for sale.</div>}
      <div className="grid-cards">
        {list.data?.listings.map((l: Listing) => (
          <div key={l.id} className="card petgrid-item">
            {l.pet_id ? <div className="art"><PetArt sticker={l.sticker} species={l.species!} look={l.look!} /></div> : <div className="art" style={{ color: "var(--ink-soft)" }}><span style={{ transform: "scale(3)", display: "inline-flex" }}><Icon name="shield" /></span></div>}
            <div className="row"><b className="grow">{l.name ?? l.kind?.replace("_", " ")}</b><RarityTag r={(l.pet_rarity ?? l.eq_rarity) as never} /></div>
            {l.pet_id && <div className="row small"><span className="muted grow">Attached balance</span><b className="num">{fmt(l.pet_balance)}</b></div>}
            <div className="row small"><span className="muted grow">by {l.seller}</span></div>
            <button className="btn leaf sm" disabled={l.seller_id === userId} onClick={() => buy(l)}>{l.seller_id === userId ? "Your listing" : `Buy · ${fmt(l.price)}`}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface Listing { id: string; price: string; seller: string; seller_id: string; pet_id: string | null; name: string | null; species: "cat" | "dog" | null; pet_rarity: string | null; sticker: string | null; look: never; pet_balance: string; equipment_id: string | null; kind: string | null; eq_rarity: string | null }

export function RanksScreen() {
  const [tab, setTab] = useState<"richest" | "gatherers" | "wins" | "losses" | "stolen" | "earnings">("richest");
  const lb = useAsync(() => api(`/api/leaderboards`), []);
  const labels = { richest: "Richest", gatherers: "Gatherers", wins: "Wins", losses: "Losses", stolen: "Stolen", earnings: "Economy" } as const;
  const rows: Array<{ id: string; name: string; owner: string; rarity: string; value: string | number }> = lb.data?.[tab] ?? [];
  const money = tab === "richest" || tab === "earnings";
  return (
    <div className="screen">
      <ScreenHead title="Leaderboards" right={<button className="btn sm paper" onClick={lb.reload}>Refresh</button>} />
      <div className="tabs seg">{(Object.keys(labels) as Array<keyof typeof labels>).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{labels[k]}</button>)}</div>
      <div className="card">
        {!rows.length && <div className="empty">No recorded activity yet.</div>}
        <table className="lb"><tbody>
          {rows.map((r, i) => (
            <tr key={r.id}><td>{i + 1}</td><td><b>{r.name}</b> <span className="small muted">· {r.owner}</span></td><td><span className={`tag rarity ${r.rarity}`}>{r.rarity}</span></td><td className="num" style={{ textAlign: "right", fontWeight: 700 }}>{money ? fmt(String(r.value)) : r.value}</td></tr>
          ))}
        </tbody></table>
      </div>
      <p className="small muted">Every ranking is computed from recorded game events and ledger entries.</p>
    </div>
  );
}

export function WalletScreen() {
  const wallet = useStore((s) => s.wallet);
  const network = useStore((s) => s.network);
  const name = useStore((s) => s.displayName);
  const me = useAsync(() => api(`/api/me`), []);
  const econ = useAsync(() => api(`/api/economy`), []);
  const faucet = async () => {
    try { const r = await api(`/api/dev/faucet`, {}); toast("good", `Added ${fmt(r.amount)} test units`); await refreshWallet(); me.reload(); }
    catch (e) { toast("bad", (e as Error).message); }
  };
  return (
    <div className="screen">
      <ScreenHead title="Wallet" right={<span className="tag">{name}</span>} />
      {network === "dev" && (
        <div className="notice" style={{ marginBottom: 12 }}>
          <b>Dev network.</b> Balances here are test units with no monetary value and no onchain backing, so the full game loop can be tested before the $CATCHAMI contracts are deployed.
          <div style={{ marginTop: 8 }}><button className="btn sm" onClick={faucet}>Get today's test units</button></div>
        </div>
      )}
      <div className="card col" style={{ marginBottom: 12 }}>
        <div className="row"><span className="muted">Available</span><b className="right num" style={{ fontSize: 24 }}>{fmt(wallet?.available)}</b></div>
        {wallet?.held !== "0" && <div className="row small"><span className="muted">On hold (pending)</span><span className="right num">{fmt(wallet?.held)}</span></div>}
        <div className="row small"><span className="muted">Exact</span><span className="right num">{wallet ? toDecimalString(BigInt(wallet.balance)) : "—"}</span></div>
      </div>
      <div className="card col" style={{ marginBottom: 12 }}>
        <h3>Add money</h3>
        <p className="small" style={{ margin: 0 }}>Deposits arrive by sending $CATCHAMI to the Catchami game contract on NEAR. Card/bank top-ups need an approved on-ramp provider that supports $CATCHAMI and your region.</p>
        <div className="notice warn small">{network === "dev" ? "Not available on the dev network: no token or game contract is deployed yet." : "Contract deposits will appear here once the game contract address is configured."}</div>
      </div>
      <div className="card col" style={{ marginBottom: 12 }}>
        <h3>Recent activity</h3>
        {me.data?.wallet?.history?.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing yet.</p>}
        <table className="lb"><tbody>
          {me.data?.wallet?.history?.map((h: { id: string; kind: string; amount: string; created_at: string }) => (
            <tr key={h.id}><td style={{ width: "auto", fontWeight: 600 }}>{h.kind.replace(/_/g, " ")}</td><td className="small muted">{new Date(h.created_at).toLocaleString()}</td><td className="num" style={{ textAlign: "right", fontWeight: 700, color: h.amount.startsWith("-") ? "var(--bad)" : "var(--good)" }}>{h.amount.startsWith("-") ? "−" : "+"}{fmt(h.amount.replace("-", ""))}</td></tr>
          ))}
        </tbody></table>
      </div>
      {econ.data && (
        <div className="card col" style={{ marginBottom: 12 }}>
          <h3>Economy transparency</h3>
          <dl className="kv">
            <dt>HQ treasury</dt><dd className="num">{fmt(econ.data.hq.balance)}</dd>
            <dt>Reserve floor</dt><dd className="num">{fmt(econ.data.hq.reserveFloor)}</dd>
            <dt>Today's merchant budget</dt><dd className="num">{fmt(econ.data.today.merchantGranted)} / {fmt(econ.data.today.merchantAllowance)}</dd>
            <dt>Today's reward pool</dt><dd className="num">{fmt(econ.data.today.rewardPaid)} / {fmt(econ.data.today.rewardPool)}</dd>
            <dt>Team fee revenue</dt><dd className="num">{fmt(econ.data.team.revenueBalance)}</dd>
            <dt>Config version</dt><dd>{econ.data.version}</dd>
          </dl>
          <p className="small muted" style={{ margin: 0 }}>No fixed earnings or returns are promised. Budgets shrink automatically as HQ nears its reserve floor.</p>
        </div>
      )}
      <div className="row"><button className="btn paper sm" onClick={() => store.set({ screen: "fairness" })}>Verify fairness</button><button className="btn ghost sm right" onClick={signOut}>Sign out</button></div>
    </div>
  );
}

export function FairnessScreen() {
  const ep = useAsync(() => api(`/api/fairness`), []);
  const [seed, setSeed] = useState(""), [label, setLabel] = useState(""), [tier, setTier] = useState<CatchTier>("basic");
  let out = "";
  try { if (seed && label) { const r = rollCatch(seed.trim(), label.trim(), tier); out = `success draw ${r.successDraw} → ${r.success ? "caught" : "escaped"}${r.rarity ? `, rarity draw ${r.rarityDraw} → ${r.rarity}` : ""}. Commitment ${commitmentOf(seed.trim()).slice(0, 16)}…`; } } catch { out = "Invalid seed"; }
  return (
    <div className="screen">
      <ScreenHead title="Fairness" onBack={() => store.set({ screen: "wallet" })} />
      <div className="notice" style={{ marginBottom: 12 }}>Each hour, the server commits to a secret seed by publishing its SHA-256 hash first. Every catch, rarity, battle, crafting and reward roll uses <code>HMAC(seed, label)</code>. When the hour ends the seed is revealed, so anyone can recompute any result. Your browser never supplies the random number.</div>
      <div className="card col" style={{ marginBottom: 12 }}>
        <h3>Verify a catch</h3>
        <label className="field">Revealed seed<input type="text" value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
        <label className="field">Label (attemptId:nonce from your result)<input type="text" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <div className="seg">{(["basic", "enhanced", "premium"] as const).map((t) => <button key={t} className={tier === t ? "on" : ""} onClick={() => setTier(t)}>{t}</button>)}</div>
        {out && <div className="notice small">{out}</div>}
      </div>
      <div className="card">
        <h3>Epochs</h3>
        <table className="lb"><tbody>
          {ep.data?.epochs?.map((e: { id: number; commitment: string; seed: string | null }) => (
            <tr key={e.id}><td style={{ width: "auto" }}>{new Date(e.id * 3600_000).toLocaleString()}</td><td className="small" style={{ wordBreak: "break-all" }}>commit {e.commitment.slice(0, 18)}…<br />{e.seed ? <button className="btn sm paper" onClick={() => setSeed(e.seed!)}>use revealed seed</button> : <span className="muted">seed revealed after this hour</span>}</td></tr>
          ))}
        </tbody></table>
      </div>
    </div>
  );
}

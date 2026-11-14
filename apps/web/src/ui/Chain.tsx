/**
 * The chain side of the Coin Vault, kept chain-neutral in wording:
 *  - On-chain card: where your coins and pet NFTs live, "Sync now".
 *  - Buy $CATCHAMI: card or any crypto (payments simulated on testnet; the
 *    coins delivered are real testnet tokens from the market allocation).
 *  - Withdraw: a pet's piggy bank -> your own wallet (two wallet signatures).
 *  - Trade: $CATCHAMI -> USDC on the DEX pool (real testnet swap), then
 *    cash out to a bank (simulated).
 */
import { useEffect, useMemo, useState } from "react";
import { toDecimalString } from "@catchami/shared";
import { store, toast, useStore } from "../net/store.ts";
import { api, refreshWallet, rid } from "../net/api.ts";
import { linkNear, prepareNear, signAndSend, WALLETS, type WalletId } from "../net/near.ts";
import { fmt, useAsync } from "./common.tsx";
import { sfx } from "./sfx.ts";

export const TOKEN_LOGO = "/token/catchami-512.webp";
const ONE = 10n ** 18n;
const usdc = (raw: string | null | undefined) => (raw ? (Number(raw) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }) : "0");
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ChainPet { id: string; name: string; tokenId: string | null; owner: string | null; custody: boolean; minted: boolean; mintTx: string | null; nftUrl: string | null; onchain: { balance: string; reserved: string; available: string } | null; offchain: string | null }
export interface ChainMe {
  enabled: boolean; network: string; nearAccount: string | null; bucket: string | null; custody: string | null;
  contracts: { game: string; token: string; usdc: string; ref: string; pool: number; explorer: string };
  userOnchain: { balance: string; available: string } | null; walletTokens: string | null; walletUsdc: string | null;
  pets: ChainPet[];
  withdrawals: Array<{ id: string; source: { Pet?: string; User?: string }; amount: string; status: string; acked: boolean; note: string | null; created_at: string }>;
  status: { lastBatch: { id: number; txHash: string | null; at: number; deltas: number } | null; lastError: string | null; unsettledJournals: number; pendingMints: number } | null;
}
export const useChain = () => useAsync(() => api<ChainMe>("/api/chain/me"), []);

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="cm-wrap" role="dialog">
      <div className="cm-back" onClick={onClose} />
      <div className="cm panel">
        <button className="sheet-x" onClick={onClose} aria-label="Close">×</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Steps({ steps, at }: { steps: string[]; at: number }) {
  return <div className="pay-steps">{steps.map((t, k) => <span key={t} className={k < at ? "done" : k === at ? "now" : ""}><i>{k < at ? "✓" : k === at ? <span className="spinner sm" /> : ""}</i>{t}</span>)}</div>;
}

const ago = (t: number) => { const s = (Date.now() - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`; };
const shortAcct = (a: string) => (a.length > 26 ? `${a.slice(0, 10)}…${a.slice(-12)}` : a);

// --------------------------------------------------------------- on-chain card --

export function ChainCard({ me, reload, onBuy, onWithdraw, onTrade }: { me: ChainMe | null; reload: () => void; onBuy: () => void; onWithdraw: () => void; onTrade: () => void }) {
  const [syncing, setSyncing] = useState(false);
  const network = useStore((s) => s.network);
  if (!me) return null;
  if (!me.enabled) return <section className="vault-card chain-card off"><h3>⛓️ On-chain</h3><p className="vault-empty">This server plays with test units only ({network || "dev"} network) — nothing goes on-chain here.</p></section>;
  const sync = async () => {
    setSyncing(true);
    try { await api("/api/chain/sync", {}); sfx.sparkle(); toast("good", "Synced to the chain ✓"); reload(); await refreshWallet(); } catch (e) { toast("bad", (e as Error).message); } finally { setSyncing(false); }
  };
  const lb = me.status?.lastBatch;
  const ex = me.contracts.explorer;
  return (
    <section className="vault-card chain-card">
      <div className="cc-head">
        <img src={TOKEN_LOGO} alt="" />
        <div><h3>$CATCHAMI on-chain</h3><small>{me.network === "mainnet" ? "Mainnet" : "Test network"} · real tokens & NFTs{me.network !== "mainnet" ? " (test value)" : ""}</small></div>
      </div>
      <div className="cc-who">
        {me.nearAccount
          ? <>👛 Wallet <a href={`${ex}/address/${me.nearAccount}`} target="_blank" rel="noreferrer"><b>{shortAcct(me.nearAccount)}</b></a></>
          : <>🛡️ Your pets' NFTs are kept safe for you. <button className="link-btn" onClick={onWithdraw}>Connect a wallet</button> to own them directly.</>}
      </div>
      <div className="cc-grid">
        <div><small>Coin Vault on-chain</small><b>{fmt(me.userOnchain?.balance ?? "0")}</b></div>
        <div><small>Pet NFTs</small><b>{me.pets.filter((p) => p.minted).length}<em>/{me.pets.length}</em></b></div>
        {me.nearAccount && <div><small>In your wallet</small><b>{fmt(me.walletTokens ?? "0")}</b></div>}
        {me.nearAccount && <div><small>USDC</small><b>${usdc(me.walletUsdc)}</b></div>}
      </div>
      <div className="cc-sync">
        <span>{lb ? <>Last sync <a href={`${ex}/txns/${lb.txHash}`} target="_blank" rel="noreferrer">#{lb.id}</a> · {ago(lb.at)}</> : "Syncs every ~30s"}{me.status?.unsettledJournals ? ` · ${me.status.unsettledJournals} moves waiting` : ""}</span>
        <button className="btn sm leaf" disabled={syncing} onClick={sync}>{syncing ? "Syncing…" : "⚡ Sync now"}</button>
      </div>
      <div className="cc-actions">
        <button className="btn paper sm" onClick={onBuy}>🪙 Buy</button>
        <button className="btn paper sm" onClick={onWithdraw}>📤 Withdraw</button>
        <button className="btn paper sm" onClick={onTrade}>💱 Trade</button>
      </div>
      <details className="cc-more">
        <summary>Contracts & proof</summary>
        <ul>
          <li>Token <a href={`${ex}/token/${me.contracts.token}`} target="_blank" rel="noreferrer">{me.contracts.token}</a> · 100T fixed supply · 40% HQ · 55% market · 5% team</li>
          <li>Game vault & pet NFTs <a href={`${ex}/address/${me.contracts.game}`} target="_blank" rel="noreferrer">{me.contracts.game}</a></li>
          {me.bucket && <li>Your vault bucket <code>{shortAcct(me.bucket)}</code></li>}
          <li>DEX pool #{me.contracts.pool} on <a href={`${ex}/address/${me.contracts.ref}`} target="_blank" rel="noreferrer">{me.contracts.ref}</a></li>
        </ul>
      </details>
    </section>
  );
}

// --------------------------------------------------------------- buy --

export function BuySheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<"card" | "intents">("card");
  const [usd, setUsd] = useState("10");
  const [asset, setAsset] = useState<string>("");
  const [q, setQ] = useState<{ tokens: string; feeUsd: number; pay: { asset: string; chain: string; amount: string }; simulated: boolean } | null>(null);
  const [step, setStep] = useState(-1);
  const [done, setDone] = useState<{ tokens: string; txUrl: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const assets = useAsync(() => api<{ assets: Array<{ assetId: string; symbol: string; blockchain: string; price: number }> }>("/api/pay/assets"), []);
  const list = useMemo(() => {
    const all = assets.data?.assets ?? [];
    if (search) return all.filter((a) => a.symbol.toLowerCase().includes(search.toLowerCase())).slice(0, 30);
    // One tile per coin, on its home chain.
    const home: Record<string, string> = { NEAR: "near", USDC: "near", USDT: "eth", ETH: "eth", BTC: "btc", SOL: "sol", ZEC: "zec", DOGE: "doge", XRP: "xrp", SUI: "sui", BNB: "bsc", ARB: "arb" };
    const seen = new Map<string, (typeof all)[number]>();
    for (const a of all) {
      const sym = a.symbol === "wNEAR" ? "NEAR" : a.symbol;
      const cur = seen.get(sym);
      if (!cur || (home[sym] === a.blockchain && home[sym] !== cur.blockchain)) seen.set(sym, a);
    }
    return [...seen.values()].slice(0, 12);
  }, [assets.data, search]);
  useEffect(() => { if (!search && list.length && !list.some((a) => a.assetId === asset)) setAsset(list[0]!.assetId); }, [list, asset, search]);
  useEffect(() => {
    setQ(null); setErr(null);
    const n = Number(usd);
    if (!n || n < 1) return;
    const t = setTimeout(() => { api<typeof q>("/api/pay/quote", { usd: n, method, asset }).then(setQ).catch((e) => setErr((e as Error).message)); }, 250);
    return () => clearTimeout(t);
  }, [usd, method, asset]);
  const buy = async () => {
    setErr(null); setStep(0); sfx.pop();
    try {
      const res = api<{ tokens: string; txUrl: string }>("/api/pay/buy", { usd: Number(usd), method, asset, rid: rid() });
      for (let k = 1; k <= 2; k++) { await wait(700); setStep(k); sfx.tick(); }
      const r = await res;
      setStep(4); setDone(r); sfx.win(); await refreshWallet(); onDone();
    } catch (e) { setErr((e as Error).message); setStep(-1); }
  };
  const steps = method === "card"
    ? ["Card checkout (simulated)…", `Charging $${Number(usd).toFixed(2)}…`, "Delivering $CATCHAMI on-chain…", "Done!"]
    : [`Sending ${q?.pay.amount ?? ""} ${q?.pay.asset ?? ""} via NEAR Intents (simulated)…`, "Intents solver swaps to USDC…", "Delivering $CATCHAMI on-chain…", "Done!"];
  return (
    <Modal title="Buy $CATCHAMI" onClose={onClose}>
      {done ? (
        <div className="buy-done">
          <img src={TOKEN_LOGO} alt="" className="spin-coin" />
          <b>+{fmt(done.tokens)}</b>
          <p className="small">Delivered to your Coin Vault on-chain.</p>
          <a className="btn paper sm" href={done.txUrl} target="_blank" rel="noreferrer">See the transaction ↗</a>
          <button className="game-btn start sm" onClick={onClose}><span className="gb-label">Nice!</span></button>
        </div>
      ) : (
        <>
          <div className="seg">
            <button className={method === "card" ? "on" : ""} onClick={() => setMethod("card")}>💳 Card</button>
            <button className={method === "intents" ? "on" : ""} onClick={() => setMethod("intents")}>🌐 Any crypto</button>
          </div>
          <div className="usd-row">
            {["5", "10", "25", "50"].map((v) => <button key={v} className={`chip ${usd === v ? "on" : ""}`} onClick={() => setUsd(v)}>${v}</button>)}
            <label className="usd-in">$<input inputMode="decimal" value={usd} onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ""))} /></label>
          </div>
          {method === "intents" && (
            <div className="asset-pick">
              <input className="asset-search" placeholder="Search 100+ assets (BTC, ETH, SOL, ZEC…)" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="asset-list">
                {list.map((a) => <button key={a.assetId} className={`asset ${asset === a.assetId ? "on" : ""}`} onClick={() => setAsset(a.assetId)}><b>{a.symbol}</b><small>{a.blockchain}</small></button>)}
                {assets.loading && <span className="small muted">Loading assets…</span>}
              </div>
            </div>
          )}
          <div className="quote-box">
            {q ? <>
              <div className="qb-get"><img src={TOKEN_LOGO} alt="" /><b>{fmt(q.tokens)}</b><small>$CATCHAMI</small></div>
              <div className="qb-line">You pay <b>{method === "card" ? `$${Number(usd).toFixed(2)}` : `${q.pay.amount} ${q.pay.asset}`}</b>{q.feeUsd ? ` · fee $${q.feeUsd.toFixed(2)}` : ""} · priced live from the DEX pool</div>
            </> : <span className="small muted">{err ?? "Getting a price…"}</span>}
          </div>
          {step >= 0 ? <Steps steps={steps} at={step} /> : <button className="game-btn start sm" disabled={!q} onClick={buy}><span className="gb-label">{method === "card" ? `Pay $${Number(usd || 0).toFixed(2)}` : `Pay with ${q?.pay.asset ?? "crypto"}`}</span></button>}
          {err && step < 0 && q && <p className="err small" style={{ margin: 0 }}>{err}</p>}
          <p className="sim-note">🧪 Test network: {method === "card" ? "no card is charged — the checkout is simulated." : "NEAR Intents only runs on mainnet, so the payment is simulated (asset prices are live)."} The $CATCHAMI you receive is a real on-chain transfer.</p>
        </>
      )}
    </Modal>
  );
}

// --------------------------------------------------------------- connect wallet --

function ConnectWallet({ onLinked }: { onLinked: () => void }) {
  const [busy, setBusy] = useState<WalletId | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { void prepareNear().catch(() => {}); }, []);
  const go = async (id: WalletId) => {
    setBusy(id); setErr(null);
    try { const r = await linkNear(id); store.set({ nearAccount: r.accountId }); toast("good", `Linked ${r.accountId} — your pet NFTs are on their way`); onLinked(); }
    catch (e) { setErr((e as Error).message); void prepareNear().catch(() => {}); } finally { setBusy(null); }
  };
  return (
    <div className="col" style={{ gap: 8 }}>
      <p className="small" style={{ margin: 0 }}>Connect a NEAR wallet to own your pet NFTs directly and withdraw their coins. The NFTs we hold for you move to your wallet automatically.</p>
      <div className="wallet-list">{WALLETS.map((w) => <button key={w.id} className="btn paper" disabled={!!busy} onClick={() => void go(w.id)}><b>{w.icon} {busy === w.id ? "Waiting for wallet…" : w.name}</b><small>{w.note}</small></button>)}</div>
      <div className="join-soon mini"><span className="soon-pill">◎ Solana · soon</span><span className="soon-pill">⟠ EVM · soon</span></div>
      {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}

// --------------------------------------------------------------- withdraw --

export function WithdrawSheet({ me, petId, onClose, onDone }: { me: ChainMe; petId?: string; onClose: () => void; onDone: () => void }) {
  const own = useStore((s) => s.own);
  const near = useStore((s) => s.nearAccount) ?? me.nearAccount;
  const mine = me.pets.filter((p) => p.minted);
  const [pick, setPick] = useState(petId ?? mine[0]?.id ?? "");
  const [amt, setAmt] = useState("");
  const [step, setStep] = useState(-1);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const cp = me.pets.find((p) => p.id === pick);
  const live = own.find((p) => p.id === pick);
  if (!near) return <Modal title="Withdraw to your wallet" onClose={onClose}><ConnectWallet onLinked={() => { onDone(); }} /></Modal>;
  const inWallet = cp && cp.owner === near;
  const go = async () => {
    if (!cp?.tokenId) return;
    let whole: bigint;
    try { whole = BigInt(amt); if (whole <= 0n) throw 0; } catch { setErr("Enter a whole number of coins"); return; }
    setErr(null); setStep(0);
    try {
      await api("/api/chain/sync", {}).catch(() => {});
      setStep(1);
      const r = await signAndSend(near, { receiverId: me.contracts.game, methodName: "request_withdrawal", args: { source: { Pet: cp.tokenId }, amount: (whole * ONE).toString() }, gasTgas: 50 });
      const id = r.value != null ? String(r.value) : null;
      setStep(2);
      let ready: ChainMe["withdrawals"][number] | undefined;
      for (let i = 0; i < 12 && !ready; i++) {
        await api("/api/chain/sync", {}).catch(() => {});
        const m = await api<ChainMe>("/api/chain/me");
        ready = m.withdrawals.find((w) => (id ? w.id === id : true) && w.status === "Pending" && w.acked);
        if (!ready) await wait(4000);
      }
      if (!ready) throw new Error("The game hasn't approved the withdrawal yet — open Withdraw again in a minute to claim it.");
      setStep(3);
      await signAndSend(near, { receiverId: me.contracts.game, methodName: "execute_withdrawal", args: { id: ready.id }, gasTgas: 100 });
      setStep(4);
      await wait(2500); await api("/api/chain/sync", {}).catch(() => {});
      setStep(5); setDone(`${whole.toLocaleString()} $CATCHAMI`); sfx.win(); await refreshWallet(); onDone();
    } catch (e) { setErr((e as Error).message); setStep(-1); }
  };
  const claim = async (id: string) => {
    try { await signAndSend(near, { receiverId: me.contracts.game, methodName: "execute_withdrawal", args: { id }, gasTgas: 100 }); await wait(2500); await api("/api/chain/sync", {}).catch(() => {}); toast("good", "Claimed to your wallet ✓"); sfx.win(); onDone(); }
    catch (e) { toast("bad", (e as Error).message); }
  };
  const waiting = me.withdrawals.filter((w) => w.status === "Pending");
  return (
    <Modal title="Withdraw to your wallet" onClose={onClose}>
      {done ? (
        <div className="buy-done"><span style={{ fontSize: 54 }}>📤</span><b>{done}</b><p className="small">is now in <b>{near}</b>. Trade it for USDC any time.</p><button className="game-btn start sm" onClick={onClose}><span className="gb-label">Done</span></button></div>
      ) : (
        <>
          {waiting.length > 0 && <div className="notice">{waiting.map((w) => <div key={w.id} className="row">⏳ {fmt(w.amount)} {w.acked ? <button className="btn sm leaf" onClick={() => claim(w.id)}>Claim now</button> : <span className="small muted">waiting for the game's OK…</span>}</div>)}</div>}
          <div className="wd-pets">
            {mine.map((p) => <button key={p.id} className={`chip ${pick === p.id ? "on" : ""}`} onClick={() => setPick(p.id)}>{p.name}</button>)}
            {!mine.length && <p className="small muted">Your pets' NFTs are still being minted — try again in a moment.</p>}
          </div>
          {cp && (
            <div className="quote-box">
              <div className="qb-line">🐷 {cp.name}'s piggy bank: <b>{fmt(live?.balance ?? cp.offchain ?? "0")}</b> · on-chain <b>{fmt(cp.onchain?.available ?? "0")}</b></div>
              {!inWallet && <div className="qb-line small">{cp.custody ? "Its NFT is moving to your wallet — this takes a few seconds after linking." : `Its NFT is held by ${cp.owner}.`}</div>}
            </div>
          )}
          <label className="field">Amount (whole $CATCHAMI)<input inputMode="numeric" value={amt} placeholder="e.g. 50000" onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} /></label>
          {step >= 0 ? <Steps at={step} steps={["Syncing the piggy bank on-chain…", "Sign the withdrawal request in your wallet…", "Game approves it…", "Sign the claim in your wallet…", "Sending to your wallet…", "Done!"]} />
            : <button className="game-btn start sm" disabled={!amt || !inWallet} onClick={go}><span className="gb-label">Withdraw</span></button>}
          {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
          <p className="sim-note">Real testnet transactions, signed by your wallet. The pet keeps working with what's left.</p>
        </>
      )}
    </Modal>
  );
}

// --------------------------------------------------------------- trade --

export function TradeSheet({ me, onClose, onDone }: { me: ChainMe; onClose: () => void; onDone: () => void }) {
  const near = useStore((s) => s.nearAccount) ?? me.nearAccount;
  const [tab, setTab] = useState<"swap" | "cash">("swap");
  const [amt, setAmt] = useState("");
  const [q, setQ] = useState<{ amount: string; usdc: string; usdcDisplay: string; minOut: string; pool: number; ref: string; token: string; usdcToken: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [cash, setCash] = useState("");
  const [cashStep, setCashStep] = useState(-1);
  const bal = me.walletTokens ? BigInt(me.walletTokens) / ONE : 0n;
  useEffect(() => {
    setQ(null); setErr(null);
    if (!amt || amt === "0") return;
    const t = setTimeout(() => api<typeof q>(`/api/swap/quote?amount=${amt}`).then(setQ).catch((e) => setErr((e as Error).message)), 250);
    return () => clearTimeout(t);
  }, [amt]);
  if (!near) return <Modal title="Trade $CATCHAMI" onClose={onClose}><ConnectWallet onLinked={onDone} /></Modal>;
  const swap = async () => {
    if (!q) return;
    setBusy(true); setErr(null);
    try {
      const msg = JSON.stringify({ force: 0, actions: [{ pool_id: q.pool, token_in: q.token, token_out: q.usdcToken, amount_in: q.amount, min_amount_out: q.minOut }] });
      const r = await signAndSend(near, { receiverId: q.token, methodName: "ft_transfer_call", args: { receiver_id: q.ref, amount: q.amount, msg }, gasTgas: 180, depositYocto: 1n });
      setTx(r.txHash); sfx.win(); toast("good", `Swapped for ~$${q.usdcDisplay} USDC`); onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const cashOut = async () => {
    setCashStep(0);
    for (let k = 1; k <= 3; k++) { await wait(800); setCashStep(k); sfx.tick(); }
    sfx.win();
  };
  return (
    <Modal title="Trade $CATCHAMI" onClose={onClose}>
      <div className="seg">
        <button className={tab === "swap" ? "on" : ""} onClick={() => setTab("swap")}>💱 Sell for USDC</button>
        <button className={tab === "cash" ? "on" : ""} onClick={() => setTab("cash")}>🏦 Cash out</button>
      </div>
      {tab === "swap" ? (
        <>
          <div className="qb-line">In your wallet: <b>{bal.toLocaleString()}</b> $CATCHAMI · <b>${usdc(me.walletUsdc)}</b> USDC</div>
          <div className="swap-box">
            <label><small>You sell</small><span><img src={TOKEN_LOGO} alt="" /><input inputMode="numeric" placeholder="0" value={amt} onChange={(e) => setAmt(e.target.value.replace(/\D/g, ""))} /><em>$CATCHAMI</em></span>
              <button className="link-btn" onClick={() => setAmt(bal.toString())}>max</button></label>
            <div className="swap-arrow">↓</div>
            <label><small>You get (est.)</small><span><i className="usdc-dot">$</i><b>{q ? q.usdcDisplay : "—"}</b><em>USDC</em></span></label>
          </div>
          {!bal && <p className="small muted" style={{ margin: 0 }}>Withdraw some coins from a pet first — they need to be in your wallet to trade.</p>}
          <button className="game-btn start sm" disabled={!q || busy || BigInt(amt || "0") > bal} onClick={swap}><span className="gb-label">{busy ? "Confirm in wallet…" : "Swap"}</span></button>
          {tx && <a className="small" href={`${me.contracts.explorer}/txns/${tx}`} target="_blank" rel="noreferrer">See the swap ↗</a>}
          {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
          <p className="sim-note">Real swap on the {me.contracts.ref} pool #{me.contracts.pool} (testnet USDC). 1% max slippage.</p>
        </>
      ) : (
        <>
          <div className="qb-line">USDC in your wallet: <b>${usdc(me.walletUsdc)}</b></div>
          <label className="field">Amount (USD)<input inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value.replace(/[^\d.]/g, ""))} placeholder="e.g. 20" /></label>
          <div className="bank-row">🏦 Bank account · <b>Demo Bank ••••</b></div>
          {cashStep >= 0 ? <Steps at={cashStep} steps={["Selling USDC for USD (simulated)…", "Sending to your bank (simulated)…", "On its way!", ""]} /> :
            <button className="game-btn start sm" disabled={!Number(cash)} onClick={cashOut}><span className="gb-label">Cash out ${Number(cash || 0).toFixed(2)}</span></button>}
          <p className="sim-note">🧪 Off-ramp is simulated on the test network — no bank details are collected and no USDC leaves your wallet.</p>
        </>
      )}
    </Modal>
  );
}

/** Small NFT badge for a pet profile. */
export function PetNftCard({ petId, onWithdraw }: { petId: string; onWithdraw: () => void }) {
  const me = useChain();
  const p = me.data?.pets.find((x) => x.id === petId);
  if (!me.data?.enabled || !p) return null;
  return (
    <div className="card col nft-card">
      <div className="row"><span className="nft-tag">NFT</span><b className="grow">{p.minted ? p.tokenId : "Minting…"}</b>{p.nftUrl && <a className="small" href={p.nftUrl} target="_blank" rel="noreferrer">View ↗</a>}</div>
      <dl className="kv">
        <dt>Owner</dt><dd>{p.custody ? "Kept safe for you" : p.owner ? shortAcct(p.owner) : "—"}</dd>
        <dt>Piggy bank on-chain</dt><dd className="num">{fmt(p.onchain?.balance ?? "0")}</dd>
      </dl>
      <button className="btn leaf" onClick={onWithdraw}>📤 Withdraw to my wallet</button>
      <p className="small muted" style={{ margin: 0 }}>The piggy bank belongs to the NFT: whoever owns {p.minted ? "this NFT" : "the pet"} owns its coins.</p>
    </div>
  );
}

export const tokenAmount = (raw: string) => toDecimalString(BigInt(raw));

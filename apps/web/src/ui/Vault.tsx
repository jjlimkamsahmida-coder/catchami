/**
 * The wallet as a game screen: the "Coin Vault". A big spinning coin and a
 * counting balance, your pets' piggy banks, chunky action tiles, an activity
 * feed with emoji receipts, and a fold-out "where do coins come from" card.
 */
import { useEffect, useRef, useState } from "react";
import { toDecimalString } from "@catchami/shared";
import { store, toast, useStore } from "../net/store.ts";
import { api, refreshWallet, signOut } from "../net/api.ts";
import { fmt, PetArt, useAsync } from "./common.tsx";
import { PageFrame } from "./GamePages.tsx";
import { genUrl } from "../game/assets.ts";
import { centerOf, flyIcons, floatLabel, screenCenter } from "./fx.ts";
import { sfx } from "./sfx.ts";
import { BuySheet, ChainCard, TOKEN_LOGO, TradeSheet, useChain, WithdrawSheet } from "./Chain.tsx";

const ONE = 10n ** 18n;
const COIN = `<img src="${genUrl("ui-coin")}" alt="" />`;

/** Friendly names + emoji for ledger entries. */
const KIND: Record<string, [string, string]> = {
  starter_purchase: ["🎁", "Starter pouch"],
  dev_faucet: ["🚰", "Free test coins"],
  catch_success: ["🎯", "Caught a pet"],
  catch_failed: ["💨", "It wriggled away"],
  pet_fund: ["🐾", "Topped up a pet"],
  pet_withdraw: ["🐷", "From a piggy bank"],
  nft_sale: ["🛒", "Marketplace"],
  sale: ["🪙", "Sold to a merchant"],
  food: ["🍖", "Meal"],
  medicine: ["💊", "Medicine"],
  craft: ["🛠️", "Crafted gear"],
  battle_win: ["⚔️", "Bubble Roulette"],
  withdrawal: ["📤", "Withdrawn to your wallet"],
  deposit: ["🪙", "Bought $CATCHAMI"],
};

function ago(iso: string) {
  // Postgres gives e.g. "2026-11-13 02:49:02.37+00": make it ISO so every browser can parse it.
  const t = new Date(iso.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")).getTime();
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Count the balance up/down like a slot machine. */
function useCount(target: number, ms = 900) {
  const [v, setV] = useState(0);
  const cur = useRef(0);
  useEffect(() => {
    const a = cur.current, b = target, t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      cur.current = a + (b - a) * e; setV(cur.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

export function WalletScreen() {
  const wallet = useStore((s) => s.wallet);
  const network = useStore((s) => s.network);
  const name = useStore((s) => s.displayName);
  const own = useStore((s) => s.own);
  const me = useAsync(() => api(`/api/me`), []);
  const econ = useAsync(() => api(`/api/economy`), []);
  const [exact, setExact] = useState(false);
  const [lore, setLore] = useState(false);
  const chain = useChain();
  const [sheet, setSheet] = useState<"buy" | "withdraw" | "trade" | null>(null);
  const afterChain = () => { chain.reload(); me.reload(); void refreshWallet(); };
  const bal = wallet ? BigInt(wallet.available) : 0n;
  const shown = useCount(Number(bal / ONE));
  const inPets = own.reduce((s, p) => s + BigInt(p.balance), 0n);

  const faucet = async () => {
    try {
      const r = await api(`/api/dev/faucet`, {});
      sfx.clink(); setTimeout(() => sfx.sparkle(), 500);
      flyIcons({ from: centerOf(".vault-tile.faucet") ?? screenCenter(), to: centerOf(".vault-coin") ?? screenCenter(), html: COIN, count: 10, cls: "coin" });
      setTimeout(() => floatLabel(centerOf(".vault-amount") ?? screenCenter(), `+${fmt(r.amount)}`, "gain"), 700);
      await refreshWallet(); me.reload();
    } catch (e) { toast("bad", (e as Error).message); }
  };
  const history: Array<{ id: string; kind: string; amount: string; created_at: string }> = me.data?.wallet?.history ?? [];
  // The network can arrive late on first load: fall back to what the server reports.
  const net = network || me.data?.wallet?.network || econ.data?.network || "";
  // Faucet days are UTC days on the server.
  const dayKey = new Date().toISOString().slice(0, 10);
  void faucet;
  // (Free test coins were removed from the vault.)
  const _claimedToday = history.some((h) => {
    if (h.kind !== "dev_faucet") return false;
    const t = new Date(h.created_at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === dayKey;
  });
  const hq = econ.data?.hq, today = econ.data?.today;
  const pct = (a?: string, b?: string) => (a && b && BigInt(b) > 0n ? Math.min(100, Number((BigInt(a) * 1000n) / BigInt(b)) / 10) : 0);

  return (
    <PageFrame title="Coin Vault" icon="ui-coin" theme="t-vault" onBack={() => store.set({ screen: "world" })} right={<span className="vault-who">👤 {name}</span>}>
      {/* Hero */}
      <section className="vault-hero">
        <div className="vault-rays" aria-hidden />
        <div className="vault-sparkles" aria-hidden>{Array.from({ length: 10 }, (_, i) => <i key={i} style={{ left: `${8 + ((i * 37) % 84)}%`, top: `${10 + ((i * 53) % 70)}%`, animationDelay: `${(i % 5) * 0.35}s` }} />)}</div>
        <img className="vault-coin" src={TOKEN_LOGO} alt="" />
        <span className="vault-label">Your coins</span>
        <button className="vault-amount" onClick={() => setExact((v) => !v)} title="Tap for the exact amount">
          {exact && wallet ? toDecimalString(BigInt(wallet.available)) : fmt(BigInt(Math.max(0, Math.round(shown))) * ONE)}
        </button>
        <div className="vault-chips">
          <span>🐷 In pets: <b>{fmt(inPets)}</b></span>
          {wallet && wallet.held !== "0" && <span>⏳ On hold: <b>{fmt(wallet.held)}</b></span>}
          {net !== "mainnet" && <span className="test">🧪 Test coins</span>}
        </div>
      </section>

      {/* Actions */}
      <section className="vault-tiles">
        <button className="vault-tile" onClick={() => store.set({ screen: "pets", petScreen: store.get().controlled, profileTab: "wallet" })}><span>🐷</span><b>Piggy banks</b><small>fund your pets</small></button>
        <button className={`vault-tile ${chain.data?.enabled ? "buy" : "locked"}`} onClick={() => chain.data?.enabled ? setSheet("buy") : toast("info", "Buying opens on the test network server.")}><span>🪙</span><b>Buy</b><small>card or crypto</small></button>
        <button className={`vault-tile ${chain.data?.enabled ? "" : "locked"}`} onClick={() => chain.data?.enabled ? setSheet("withdraw") : toast("info", "Withdrawals open on the test network server.")}><span>📤</span><b>Withdraw</b><small>to your wallet</small></button>
        <button className={`vault-tile ${chain.data?.enabled ? "" : "locked"}`} onClick={() => chain.data?.enabled ? setSheet("trade") : toast("info", "Trading opens on the test network server.")}><span>💱</span><b>Trade</b><small>sell for USDC</small></button>
        <button className="vault-tile" onClick={() => store.set({ screen: "fairness" })}><span>🎲</span><b>Fair rolls</b><small>check any roll</small></button>
      </section>

      <ChainCard me={chain.data} reload={afterChain} onBuy={() => setSheet("buy")} onWithdraw={() => setSheet("withdraw")} onTrade={() => setSheet("trade")} />
      {sheet === "buy" && <BuySheet onClose={() => setSheet(null)} onDone={afterChain} />}
      {sheet === "withdraw" && chain.data && <WithdrawSheet me={chain.data} onClose={() => setSheet(null)} onDone={afterChain} />}
      {sheet === "trade" && chain.data && <TradeSheet me={chain.data} onClose={() => setSheet(null)} onDone={afterChain} />}

      {/* Pets' piggy banks */}
      {own.length > 0 && (
        <section className="vault-card">
          <h3>🐷 Piggy banks</h3>
          <div className="vault-pigs">
            {own.map((p) => (
              <button key={p.id} className="vault-pig" onClick={() => store.set({ screen: "pets", petScreen: p.id, profileTab: "wallet" })}>
                <span className="vp-art"><PetArt sticker={p.sticker} species={p.species} look={p.look} /></span>
                <b>{p.name}</b>
                <span className="vp-bal"><img src={genUrl("ui-coin")} alt="" />{fmt(p.balance)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Activity */}
      <section className="vault-card">
        <h3>📜 Recent activity</h3>
        {!history.length && <p className="vault-empty">Nothing yet — go catch a pet!</p>}
        <ul className="vault-feed">
          {history.map((h) => {
            const [ico, label] = KIND[h.kind] ?? ["🔸", h.kind.replace(/_/g, " ")];
            const neg = h.amount.startsWith("-");
            return (
              <li key={h.id}>
                <span className="vf-ico">{ico}</span>
                <span className="vf-what"><b>{label}</b><small>{ago(h.created_at)}</small></span>
                <span className={`vf-amt ${neg ? "neg" : "pos"}`}>{neg ? "−" : "+"}{fmt(h.amount.replace("-", ""))}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Where coins come from */}
      <section className="vault-card">
        <button className="vault-fold" onClick={() => setLore((v) => !v)}>🏰 Where do coins come from? <span>{lore ? "▴" : "▾"}</span></button>
        {lore && hq && today && (
          <div className="vault-lore">
            <p>Every coin is real and counted. Merchants are paid from <b>HQ's treasury</b>, which is refilled by what players spend on catches, meals, medicine, gear and fees. Nothing is printed.</p>
            <div className="vl-bar"><span>HQ treasury</span><i><b style={{ width: `${pct(hq.balance, "40000000000000000000000000000000")}%` }} /></i><em>{fmt(hq.balance)}</em></div>
            <div className="vl-bar"><span>Today's merchant budget used</span><i><b style={{ width: `${pct(today.merchantGranted, today.merchantAllowance)}%` }} /></i><em>{fmt(today.merchantGranted)} / {fmt(today.merchantAllowance)}</em></div>
            <div className="vl-facts">
              <span>🛟 Safety floor <b>{fmt(hq.reserveFloor)}</b></span>
              <span>📈 7-day revenue/day <b>{fmt(hq.avgDailyRevenue)}</b></span>
              <span>🎨 Creator fees <b>{fmt(econ.data.team.revenueBalance)}</b></span>
            </div>
          </div>
        )}
      </section>

      <button className="vault-signout" onClick={signOut}>Sign out</button>
    </PageFrame>
  );
}

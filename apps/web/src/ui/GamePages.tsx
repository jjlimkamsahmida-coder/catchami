/**
 * Game-style menu pages: Bag (your pet's inventory), Collection (card album),
 * Marketplace (buy and sell pets) and Ranks (podium leaderboards). Each page
 * has a big back button that returns to the game world.
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  carryCapacity, ECONOMY, formatTokens, inventoryWeight, RARITIES, RARITY_LABEL, RESOURCE_LABEL, RESOURCES, tokens,
  type OwnPet, type Rarity, type Species,
} from "@catchami/shared";
import { controlledPet, store, toast, useStore } from "../net/store.ts";
import { api, refreshWallet, rid, send } from "../net/api.ts";
import { fmt, fmtQty, PetArt, useAsync } from "./common.tsx";
import { CollectorCard, cardFromPet } from "./CollectorCard.tsx";
import { GearTab, StrategyTab, WalletTab } from "./Pets.tsx";
import { genUrl } from "../game/assets.ts";
import { sfx } from "./sfx.ts";
import { PhoneHandoff } from "./Journey.tsx";

const backToGame = () => store.set({ screen: "world", petScreen: null, sheet: null });

/** Shared page chrome: themed header with a big back button. */
function PageFrame({ title, icon, theme, onBack = backToGame, right, children }: { title: string; icon: string; theme: string; onBack?: () => void; right?: ReactNode; children: ReactNode }) {
  return (
    <div className={`gpage ${theme}`}>
      <header className="gpage-head">
        <button className="gpage-back" onClick={onBack} aria-label="Back to game"><svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" /></svg></button>
        <span className="gpage-title"><img src={genUrl(icon)} alt="" />{title}</span>
        <span className="gpage-right">{right}</span>
      </header>
      <div className="gpage-body">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------ Bag

export function BagScreen({ p }: { p: OwnPet }) {
  const [tab, setTab] = useState<"bag" | "strategy" | "wallet" | "gear">("bag");
  const controlled = useStore((s) => s.controlled);
  const ticker = useStore((s) => s.ticker);
  const w = inventoryWeight(p.carried), cap = carryCapacity(p.stats);
  const hp = p.hp / p.stats.maxHp, en = p.energy / p.stats.maxEnergy, fed = 1 - p.hunger / ECONOMY.stats.hungerMax;
  const fromCollection = store.get().screen === "pets" && controlled !== p.id;
  const bar = (k: string, label: string, v: number, text: string) => (
    <div className={`bag-need ${k}`}><span>{label}</span><i><b style={{ width: `${Math.max(3, v * 100)}%` }} /></i><em>{text}</em></div>
  );
  return (
    <PageFrame title="Bag" icon="ui-backpack" theme="t-bag" onBack={fromCollection ? () => store.set({ petScreen: null }) : backToGame}
      right={<span className="gpage-coins"><img src={genUrl("ui-coin")} alt="" />{fmt(p.balance)}</span>}>
      <div className="bag-hero">
        <div className={`bag-avatar r-${p.rarity}`}><PetArt sticker={p.sticker} species={p.species} look={p.look} /></div>
        <div className="bag-who">
          <b>{p.name}</b>
          <span className={`rar-chip ${p.rarity}`}>{RARITY_LABEL[p.rarity]}</span>
          <small>{p.activity}</small>
          {controlled !== p.id && <button className="chip-btn" onClick={() => { send({ t: "select", petId: p.id }); store.set({ controlled: p.id, screen: "world", petScreen: null }); }}>Play as {p.name}</button>}
        </div>
      </div>
      <div className="gtabs">
        {(["bag", "strategy", "wallet"] as const).map((t) => <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{{ bag: "🎒 Bag", strategy: "🤖 Autopilot", wallet: "🪙 Piggy bank", gear: "🛡️ Gear" }[t]}</button>)}
      </div>
      {tab === "bag" && (
        <>
          <div className="bag-needs">
            {bar("hp", "HP", hp, `${p.hp}/${p.stats.maxHp}`)}
            {bar("en", "Energy", en, `${p.energy}/${p.stats.maxEnergy}`)}
            {bar("fd", "Food", fed, fed < 0.3 ? "hungry!" : "fed")}
          </div>
          <div className="bag-slots">
            {RESOURCES.map((r) => (
              <div key={r} className={`bag-slot ${p.carried[r] ? "" : "empty"}`}>
                <img src={genUrl(`icon-${r}`)} alt="" />
                <b>{fmtQty(p.carried[r])}</b>
                <small>{RESOURCE_LABEL[r]}</small>
              </div>
            ))}
          </div>
          <div className="bag-cap"><span>Bag space</span><i><b style={{ width: `${Math.min(100, (w / cap) * 100)}%` }} /></i><em>{fmtQty(w)} / {fmtQty(cap)}</em></div>
          <div className="bag-actions">
            {p.carried.fish > 0 && p.hunger > 100 && <button className="gbig leaf" onClick={() => { send({ t: "eat_own", petId: p.id }); sfx.pop(); }}><img src={genUrl("icon-fish")} alt="" />Eat own fish</button>}
            <button className="gbig sun" disabled={p.hunger < 50 || (ticker?.hqStock.fish ?? 0) < ECONOMY.food.fishPerMeal} onClick={() => send({ t: "buy", petId: p.id, item: "food", rid: rid() })}>🍖 Buy meal · {fmt(ECONOMY.food.price)}</button>
            <button className="gbig coral" disabled={p.status !== "knocked_out" && p.hp >= p.stats.maxHp} onClick={() => send({ t: "buy", petId: p.id, item: "medicine", rid: rid() })}>💊 Medicine · {fmt(ECONOMY.medicine.price)}</button>
            <button className="gbig sky" disabled={p.status === "knocked_out"} onClick={() => send({ t: "rest", petId: p.id })}>💤 Take a nap</button>
          </div>
          <p className="gpage-tip">Tip: sell your loot to travelling merchants — and watch out for other Keepers challenging you in the wild!</p>
        </>
      )}
      {tab === "strategy" && <div className="gpage-card"><StrategyTab p={p} /></div>}
      {tab === "wallet" && <div className="gpage-card"><WalletTab p={p} /></div>}
      {tab === "gear" && <div className="gpage-card"><GearTab p={p} /></div>}
    </PageFrame>
  );
}

// ------------------------------------------------------------ Collection album

export function CollectionScreen() {
  const own = useStore((s) => s.own);
  const [filter, setFilter] = useState<Rarity | "all">("all");
  const counts = useMemo(() => Object.fromEntries(RARITIES.map((r) => [r, own.filter((p) => p.rarity === r).length])) as Record<Rarity, number>, [own]);
  const list = own.filter((p) => filter === "all" || p.rarity === filter).sort((a, b) => RARITIES.indexOf(b.rarity) - RARITIES.indexOf(a.rarity));
  const empty = Math.max(0, (list.length < 6 ? 6 : 3) - (list.length % 3 === 0 && list.length >= 6 ? 3 : list.length % 3));
  const cardW = Math.min(112, Math.floor((Math.min(window.innerWidth, 520) - 60) / 3));
  return (
    <PageFrame title="Collection" icon="ui-heart" theme="t-album" right={<span className="album-count">{own.length} caught</span>}>
      <div className="album-filters">
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All <b>{own.length}</b></button>
        {RARITIES.filter((r) => counts[r]).map((r) => <button key={r} className={`${filter === r ? "on" : ""} ${r}`} onClick={() => setFilter(r)}>{RARITY_LABEL[r]} <b>{counts[r]}</b></button>)}
      </div>
      <div className="album">
        {list.map((p, i) => (
          <button key={p.id} className="album-slot" style={{ animationDelay: `${i * 50}ms` }} onClick={() => store.set({ petScreen: p.id })}>
            <CollectorCard card={cardFromPet(p)} width={cardW} />
            {p.id === store.get().controlled && <span className="album-active">★ playing</span>}
          </button>
        ))}
        {Array.from({ length: empty }, (_, i) => (
          <button key={`e${i}`} className="album-slot empty" onClick={() => store.set({ screen: "catch", petScreen: null })} style={{ width: cardW, height: cardW * 1.4 }}>
            <span>?</span><small>Catch more!</small>
          </button>
        ))}
      </div>
    </PageFrame>
  );
}

// ------------------------------------------------------------ Marketplace

interface Listing { stats?: import("@catchami/shared").Stats | null; traits?: string[]; id: string; price: string; seller: string; seller_id: string; pet_id: string | null; name: string | null; species: Species | null; pet_rarity: Rarity | null; sticker: string | null; look: never; pet_balance: string }

const SUGGEST: Record<Rarity, number> = { common: 8_000_000, uncommon: 18_000_000, rare: 45_000_000, epic: 110_000_000, legendary: 240_000_000, mythic: 450_000_000 };

export function MarketScreen() {
  const [tab, setTab] = useState<"buy" | "sell">("buy");
  const [rarity, setRarity] = useState<Rarity | "">("");
  const userId = useStore((s) => s.userId);
  const wallet = useStore((s) => s.wallet);
  const q = new URLSearchParams({ kind: "animal", ...(rarity ? { rarity } : {}) });
  const list = useAsync(() => api<{ listings: Listing[] }>(`/api/market?${q}`), [q.toString(), tab]);
  const [confirm, setConfirm] = useState<Listing | null>(null);
  const buy = async (l: Listing) => {
    try {
      await api(`/api/market/${l.id}/buy`, { expectedPetBalance: l.pet_balance });
      sfx.win(); toast("good", `${l.name} joined your collection!`);
      setConfirm(null); list.reload(); await refreshWallet();
    } catch (e) { toast("bad", (e as Error).message); setConfirm(null); list.reload(); }
  };
  const wide = window.innerWidth >= 900;
  const cardW = wide ? 196 : Math.min(150, Math.floor((Math.min(window.innerWidth, 560) - 76) / 2));
  return (
    <PageFrame title="Marketplace" icon="prop-stall-0" theme="t-market" right={<span className="gpage-coins"><img src={genUrl("ui-coin")} alt="" />{fmt(wallet?.available)}</span>}>
      <div className="awning" aria-hidden />
      <div className="mkt-hero">
        <img src={genUrl("prop-stall-0")} alt="" />
        <div><b>Paw Market</b><span>Adopt rare friends from other Keepers — or sell your own!</span></div>
      </div>
      <div className="gtabs big">
        <button className={tab === "buy" ? "on" : ""} onClick={() => setTab("buy")}>🛒 Buy pets</button>
        <button className={tab === "sell" ? "on" : ""} onClick={() => setTab("sell")}>🏷️ Sell my pet</button>
      </div>
      {tab === "buy" && (
        <>
          <div className="album-filters">
            <button className={!rarity ? "on" : ""} onClick={() => setRarity("")}>All</button>
            {RARITIES.map((r) => <button key={r} className={`${rarity === r ? "on" : ""} ${r}`} onClick={() => setRarity(r)}>{RARITY_LABEL[r]}</button>)}
          </div>
          {list.loading && <p className="gpage-tip">Opening the stalls…</p>}
          {list.data && !list.data.listings.length && <div className="gpage-empty">No pets for sale right now. Check back soon!</div>}
          <div className="shelf">
            {list.data?.listings.filter((l) => l.pet_id).map((l, i) => {
              const mine = l.seller_id === userId;
              return (
                <div key={l.id} className={`shelf-item r-${l.pet_rarity ?? "common"}`} style={{ animationDelay: `${i * 60}ms` }}>
                  <CollectorCard width={cardW} card={{ id: l.pet_id!, name: l.name ?? "Pet", species: l.species ?? "cat", rarity: l.pet_rarity ?? "common", sticker: l.sticker, look: l.look ?? ({ hue: 30, outline: 0, pattern: 0, bounce: 100 } as never), stats: l.stats ?? null, traits: l.traits }} />
                  <div className="price-tag"><img src={genUrl("ui-coin")} alt="" />{fmt(l.price)}</div>
                  <small className="seller">by {mine ? "you" : l.seller}{BigInt(l.pet_balance || "0") > 0n ? ` · comes with ${fmt(l.pet_balance)}` : ""}</small>
                  <button className="gbig leaf" disabled={mine} onClick={() => setConfirm(l)}>{mine ? "Your listing" : "Buy!"}</button>
                </div>
              );
            })}
          </div>
          {confirm && (
            <div className="howto-backdrop" onClick={() => setConfirm(null)}>
              <div className="buy-confirm panel" onClick={(e) => e.stopPropagation()}>
                <h3>Adopt {confirm.name}?</h3>
                <p className="price-tag big"><img src={genUrl("ui-coin")} alt="" />{fmt(confirm.price)}</p>
                <p className="small muted" style={{ margin: 0 }}>You have {fmt(wallet?.available)}. The seller pays a 2% fee.</p>
                <div className="row"><button className="btn paper grow" onClick={() => setConfirm(null)}>Not now</button><button className="btn leaf grow" disabled={!wallet || BigInt(wallet.available) < BigInt(confirm.price)} onClick={() => void buy(confirm)}>Buy it!</button></div>
              </div>
            </div>
          )}
        </>
      )}
      {tab === "sell" && <SellPanel onListed={() => { setTab("buy"); list.reload(); }} />}
    </PageFrame>
  );
}

function SellPanel({ onListed }: { onListed: () => void }) {
  const own = useStore((s) => s.own);
  const controlled = useStore((s) => s.controlled);
  const userId = useStore((s) => s.userId);
  const sellable = own.filter((p) => !p.listed);
  const [pick, setPick] = useState<string | null>(sellable.find((p) => p.id !== controlled)?.id ?? sellable[0]?.id ?? null);
  const pet = own.find((p) => p.id === pick) ?? null;
  const [price, setPrice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const mine = useAsync(() => api<{ listings: Listing[] }>(`/api/market?kind=animal`), []);
  const myListings = mine.data?.listings.filter((l) => l.seller_id === userId) ?? [];
  const suggested = pet ? SUGGEST[pet.rarity] : 0;
  const list = async () => {
    if (!pet) return;
    const whole = Number((price || String(suggested / 1_000_000)).replace(/[^0-9.]/g, "")) * (price ? 1_000_000 : 1_000_000);
    if (!whole || whole <= 0) { toast("bad", "Set a price"); return; }
    setBusy(true);
    try {
      await api("/api/market/list", { petId: pet.id, price: tokens(Math.round(whole)).toString() });
      sfx.sparkle(); toast("good", `${pet.name} is now for sale!`);
      onListed();
    } catch (e) { toast("bad", (e as Error).message); } finally { setBusy(false); }
  };
  const cancel = async (id: string) => { try { await api(`/api/market/${id}/cancel`, {}); toast("info", "Listing removed"); mine.reload(); } catch (e) { toast("bad", (e as Error).message); } };
  return (
    <div className="sell">
      {!sellable.length ? <div className="gpage-empty">No pets to sell yet — catch one first!</div> : (
        <>
          <p className="gpage-tip">Pick a pet to put on the shelf. Its piggy bank goes with it.</p>
          <div className="sell-pick">
            {sellable.map((p) => (
              <button key={p.id} className={`sell-pet ${pick === p.id ? "on" : ""}`} onClick={() => { setPick(p.id); setPrice(""); }}>
                <span className={`bag-avatar small r-${p.rarity}`}><PetArt sticker={p.sticker} species={p.species} look={p.look} /></span>
                <b>{p.name}</b><small>{RARITY_LABEL[p.rarity]}</small>
              </button>
            ))}
          </div>
          {pet && (
            <div className="sell-form">
              {pet.id === controlled && <p className="small" style={{ margin: 0 }}>⚠️ This is the pet you're playing as.</p>}
              <label>Price in millions of $CATCHAMI
                <span className="price-input"><img src={genUrl("ui-coin")} alt="" /><input inputMode="decimal" placeholder={String(suggested / 1_000_000)} value={price} onChange={(e) => setPrice(e.target.value)} /><b>M</b></span>
              </label>
              <small className="muted">Suggested for a {RARITY_LABEL[pet.rarity]}: {formatTokens(tokens(suggested))}</small>
              <button className="game-btn start sm" disabled={busy} onClick={list}><span className="gb-label">{busy ? "Listing…" : `Sell ${pet.name}`}</span></button>
            </div>
          )}
        </>
      )}
      {myListings.length > 0 && (
        <div className="my-listings">
          <h4>Your stall</h4>
          {myListings.map((l) => (
            <div key={l.id} className="my-listing"><b>{l.name}</b><span className="price-tag"><img src={genUrl("ui-coin")} alt="" />{fmt(l.price)}</span><button className="chip-btn" onClick={() => void cancel(l.id)}>Take back</button></div>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ Ranks

type Row = { id: string; name: string; owner: string; rarity: Rarity; sticker?: string | null; value: string | number };
const BOARDS = { richest: ["💰", "Richest"], gatherers: ["🧺", "Gatherers"], wins: ["🏆", "Champions"], stolen: ["🦝", "Sneakiest"], earnings: ["📈", "Earners"] } as const;

export function RanksScreen() {
  const [tab, setTab] = useState<keyof typeof BOARDS>("richest");
  const lb = useAsync(() => api<Record<string, Row[]>>(`/api/leaderboards`), []);
  const rows: Row[] = lb.data?.[tab] ?? [];
  const money = tab === "richest" || tab === "earnings";
  const val = (r: Row) => (money ? fmt(String(r.value)) : fmtQty(Number(r.value)));
  const podium = [rows[1], rows[0], rows[2]];
  const avatar = (r: Row) => <img src={r.sticker || genUrl("cube-happy")} alt="" onError={(e) => { (e.target as HTMLImageElement).src = genUrl("cube-happy"); }} />;
  return (
    <PageFrame title="Leaderboard" icon="ui-trophy" theme="t-ranks" right={<button className="chip-btn" onClick={lb.reload}>↻</button>}>
      <div className="gtabs scroll">{(Object.keys(BOARDS) as Array<keyof typeof BOARDS>).map((k) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{BOARDS[k][0]} {BOARDS[k][1]}</button>)}</div>
      {!rows.length && !lb.loading && <div className="gpage-empty">No champions yet — go make history!</div>}
      {rows.length > 0 && (
        <div className="podium">
          {podium.map((r, i) => r ? (
            <div key={r.id} className={`pod p${[2, 1, 3][i]}`}>
              <span className="pod-crown">{["🥈", "👑", "🥉"][i]}</span>
              <span className={`pod-av r-${r.rarity}`}>{avatar(r)}</span>
              <b>{r.name}</b>
              <small>{r.owner}</small>
              <div className="pod-block"><span>{[2, 1, 3][i]}</span><em>{val(r)}</em></div>
            </div>
          ) : <div key={i} className="pod empty" />)}
        </div>
      )}
      <div className="rank-list">
        {rows.slice(3).map((r, i) => (
          <div key={r.id} className="rank-row" style={{ animationDelay: `${i * 40}ms` }}>
            <span className="rank-n">{i + 4}</span>
            <span className={`pod-av small r-${r.rarity}`}>{avatar(r)}</span>
            <span className="rank-name"><b>{r.name}</b><small>{r.owner}</small></span>
            <span className="rank-val">{val(r)}</span>
          </div>
        ))}
      </div>
    </PageFrame>
  );
}

/** Computers have no catching camera: show the phone QR, then reveal the new pet when it arrives. */
export function DesktopCatchScreen() {
  const own = useStore((s) => s.own);
  const [start] = useState(() => new Set(store.get().own.map((p) => p.id)));
  const fresh = own.find((p) => !start.has(p.id)) ?? null;
  return (
    <PageFrame title="Catch a pet" icon="cube-excited" theme="catchp">
      {fresh ? (
        <div className="dcatch-reveal">
          <h2 className="dcatch-title">New friend caught!</h2>
          <CollectorCard flipIn width={260} card={cardFromPet(fresh)} />
          <button className="game-btn start" onClick={backToGame}><span className="gb-label">Back to the game</span></button>
        </div>
      ) : (
        <div className="dcatch">
          <p className="dcatch-lead">Catching uses your phone's camera. Scan the code, point your phone at a real cat or dog, and throw a CamiCube!</p>
          <PhoneHandoff />
        </div>
      )}
    </PageFrame>
  );
}

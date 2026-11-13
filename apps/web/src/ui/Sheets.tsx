import { AREA_BOUNDS, ECONOMY, nodeStock, RESOURCE_LABEL, RESOURCES, inventoryWeight, type Resource } from "@catchami/shared";
import { controlledPet, entities, store, useStore } from "../net/store.ts";
import { rid, send } from "../net/api.ts";
import { fmt, fmtQty, PetArt, RarityTag, ResIcon, Sheet } from "./common.tsx";
import { banditArt, genUrl } from "../game/assets.ts";

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
  if (!m) return null;
  const fresh = det && Date.now() - det.at < 2500;
  const open = m.state !== "at_hq" && m.state !== "unavailable";
  const sell = (items: Partial<Record<Resource, number>>) => p && send({ t: "sell", petId: p.id, merchantId: id, items });
  return (
    <Sheet onClose={close}>
      <div className="col" style={{ gap: 12 }}>
        <div className="row"><h2 className="grow">{m.name}</h2><span className="tag">{m.state === "at_hq" ? "restocking at HQ" : m.state === "unavailable" ? "no budget right now" : m.state}</span></div>
        {!open && <div className="notice">{m.state === "unavailable" ? "HQ couldn't fund this merchant's next trip within today's budget. They'll head out again when funds allow." : "Back at HQ delivering goods and collecting the next budget."}</div>}
        {open && !fresh && (
          <div className="notice">
            Cash and stock are only visible up close. Walk {p ? p.name : "your pet"} next to {m.name.split(" ")[0]} to trade.
            <div style={{ marginTop: 8 }}><button className="btn sm" onClick={() => { send({ t: "goto", x: m.x, y: m.y }); close(); }}>Walk there</button></div>
          </div>
        )}
        {open && fresh && det && (
          <>
            <dl className="kv">
              <dt>Cash on hand</dt><dd className="num">{fmt(det.detail.cash)}</dd>
              <dt>Cart space left</dt><dd className="num">{det.detail.capacityLeft}</dd>
            </dl>
            <div className="card col" style={{ gap: 6 }}>
              {RESOURCES.map((r) => (
                <div className="row" key={r}>
                  <ResIcon r={r} size={24} />
                  <span className="grow" style={{ fontWeight: 600 }}>{RESOURCE_LABEL[r]}</span>
                  <span className="small muted">stock {det.detail.inventory[r]}</span>
                  <span className="num" style={{ minWidth: 70, textAlign: "right", fontWeight: 700 }}>{fmt(det.detail.prices[r])}</span>
                  <button className="btn sm leaf" disabled={!p || !p.carried[r]} onClick={() => sell({ [r]: p!.carried[r] })}>Sell {p?.carried[r] ?? 0}</button>
                </div>
              ))}
            </div>
            <button className="btn leaf block" disabled={!p || inventoryWeight(p.carried) === 0} onClick={() => sell(p!.carried)}>Sell everything</button>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn sun grow" disabled={!p || p.hunger < 50} onClick={() => p && send({ t: "buy", petId: p.id, item: "food", rid: rid() })}>🍖 Buy meal · {fmt(ECONOMY.food.price)}</button>
              <button className="btn coral grow" disabled={!p || (p.status !== "knocked_out" && p.hp >= p.stats.maxHp)} onClick={() => p && send({ t: "buy", petId: p.id, item: "medicine", rid: rid() })}>💊 Medicine · {fmt(ECONOMY.medicine.price)}</button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Prices follow live demand and HQ's treasury health. The merchant pays from its own HQ-funded budget and stops buying when cash or cart space runs out.</p>
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
            <button className="btn paper block sm" disabled={!controlled || safe || dist > ECONOMY.battle.challengeRangePx} onClick={() => { send({ t: "challenge", petId: controlled!.id, targetId: id }); close(); }}>
              Quick scuffle (auto battle)
            </button>
            <p className="small muted" style={{ margin: 0 }}>Bubble Roulette is a live turn-based match — the other owner must be online and accept. HP is the score; a splash costs 20.</p>
            <p className="small muted" style={{ margin: 0 }}>
              Battles here are <b>non-redeemable</b>: no tokens are at stake. HP damage persists, and the winner can take up to 15% of the loser's carried resources. The other owner's battle settings decide whether they accept.
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
        <button className="btn block" disabled={!p || p.status === "knocked_out"} onClick={() => { send({ t: "gather", petId: p!.id, nodeId: id }); close(); }}>
          {p ? `Send ${p.name} to gather` : "Catch a pet first"}
        </button>
      </div>
    </Sheet>
  );
}

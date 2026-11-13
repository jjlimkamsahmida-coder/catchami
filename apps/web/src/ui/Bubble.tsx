/**
 * Bubble Roulette — client view. Pure presentation of the server's match
 * state: the client never knows which slots are loaded, only how many are left.
 */
import { useEffect, useRef, useState } from "react";
import { BUBBLE, ECONOMY, RESOURCES, RESOURCE_LABEL, type BubbleMatchView } from "@catchami/shared";
import { store, useStore } from "../net/store.ts";
import { send, serverNow } from "../net/api.ts";
import { fmt, PetArt } from "./common.tsx";
import { sfx } from "./sfx.ts";
import { genUrl } from "../game/assets.ts";
import { Ribbon } from "./Ribbon.tsx";

const art = (k: string) => genUrl(k);

export function BubbleInvite() {
  const inv = useStore((s) => s.bubbleInvite);
  const [, force] = useState(0);
  useEffect(() => { const id = setInterval(() => force((n) => n + 1), 500); return () => clearInterval(id); }, []);
  if (!inv) return null;
  const left = Math.max(0, Math.ceil((inv.expiresAt - serverNow()) / 1000));
  if (left === 0) return null;
  const answer = (accept: boolean) => { send({ t: "br_respond", matchId: inv.matchId, accept }); store.set({ bubbleInvite: null }); };
  return (
    <div className="br-invite panel">
      <div style={{ width: 64, height: 64, flex: "none" }}><PetArt sticker={inv.sticker} species={inv.species} look={inv.look} /></div>
      <div className="col grow" style={{ gap: 6 }}>
        <b>{inv.fromName} challenges you to Bubble Roulette!</b>
        <span className="small muted">from {inv.ownerName} · {inv.demo ? "demo rival · winner takes part of the loser's bag" : `winner takes ${ECONOMY.battle.stake.minShareBps / 100}–${ECONOMY.battle.stake.maxShareBps / 100}% of the loser's coins and bag`} · {left}s</span>
        <div className="row">
          <button className="btn sm paper grow" onClick={() => answer(false)}>Not now</button>
          <button className="btn sm leaf grow" onClick={() => answer(true)}>Play!</button>
        </div>
      </div>
    </div>
  );
}

type Fx = { id: number; kind: "splash" | "puff"; target: "a" | "b"; reload: boolean };

export function BubbleScreen() {
  const m = useStore((s) => s.bubble);
  const [fx, setFx] = useState<Fx | null>(null);
  const [shownHp, setShownHp] = useState<{ a: number; b: number } | null>(null);
  const [, tick] = useState(0);
  const lastTurn = useRef(0);
  const acted = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const land = useStageLayout(root);
  const [rulesFor, setRulesFor] = useState<string | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  // Explain the rules at the start of every match (the first turn has extra time for this).
  useEffect(() => {
    if (m && m.state === "active" && m.turnNo <= 1 && rulesFor !== m.id) { setRulesFor(m.id); setRulesOpen(true); }
  }, [m?.id, m?.state]);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 250); return () => clearInterval(id); }, []);

  // Play the animation for each newly resolved action, then reveal the new HP.
  useEffect(() => {
    if (!m) return;
    if (!shownHp) { setShownHp({ a: m.a.battleHp, b: m.b.battleHp }); }
    if (m.last && m.last.turnNo !== lastTurn.current) {
      lastTurn.current = m.last.turnNo;
      sfx.whirr();
      const f: Fx = { id: m.last.turnNo, kind: m.last.loaded ? "splash" : "puff", target: m.last.target, reload: m.last.reloaded };
      setTimeout(() => { setFx(f); (f.kind === "splash" ? sfx.splash : sfx.puff)(); }, 450);
      setTimeout(() => setShownHp({ a: m.a.battleHp, b: m.b.battleHp }), 900);
      setTimeout(() => setFx((cur) => (cur?.id === f.id ? null : cur)), 1700);
    } else if (!m.last) setShownHp({ a: m.a.battleHp, b: m.b.battleHp });
    if (m.state === "finished") setTimeout(() => sfx.win(), 1300);
  }, [m?.last?.turnNo, m?.state]);

  if (!m) return null;
  const me = m.you ?? "a";
  const them = me === "a" ? "b" : "a";
  const mine = m[me], theirs = m[them];
  const hp = shownHp ?? { a: m.a.battleHp, b: m.b.battleHp };
  const myTurn = m.state === "active" && m.turn === me;
  const secs = Math.max(0, Math.ceil((m.turnEndsAt - serverNow()) / 1000));
  const busy = fx !== null || acted.current === m.turnNo;
  const act = (target: "self" | "opponent") => {
    if (!myTurn || busy) return;
    acted.current = m.turnNo;
    sfx.pop();
    send({ t: "br_action", matchId: m.id, target, turnNo: m.turnNo });
  };
  const close = () => store.set({ bubble: null });
  const finished = m.state === "finished" || m.state === "cancelled";
  const won = m.state === "finished" && m.winner === me;

  return (
    <div ref={root} className={`br ${myTurn ? "my-turn" : ""} ${land ? "staged" : ""}`} style={land ? ({ "--stk": `${land.stk}px`, "--gun": `${land.gunW}px` } as React.CSSProperties) : undefined}>
      <div className="br-bubbles" aria-hidden>{Array.from({ length: 12 }, (_, i) => <i key={i} style={{ left: `${(i * 8.7) % 100}%`, animationDelay: `${(i % 6) * 0.7}s`, width: 14 + (i % 4) * 8, height: 14 + (i % 4) * 8 }} />)}</div>
      <div className="br-top">
        <span className="br-title">Bubble Roulette</span>
        {!finished && <button className="btn sm paper br-help" onClick={() => setRulesOpen(true)} aria-label="How to play">?</button>}
        {!finished && <button className="btn sm paper" onClick={() => { if (confirm(m.state === "invited" ? "Withdraw the challenge?" : "Leave the match? Leaving counts as a loss.")) send({ t: "br_forfeit", matchId: m.id }); }}>{m.state === "invited" ? "Cancel" : "Leave"}</button>}
      </div>

      {m.state === "active" && (
        <div key={m.turnNo} className={`br-banner ${myTurn ? "mine" : ""}`}>
          <b>{myTurn ? (m.actionsLeft > 1 ? `EXTRA SHOTS ×${m.actionsLeft}!` : "YOUR TURN!") : `${theirs.name}'s turn`}</b>
          <span className="br-secs"><img className="br-clock" src={art("br-timer")} alt="" />{secs}s</span>
        </div>
      )}
      <div className="br-arena">
        {(["mine", "theirs"] as const).map((who) => {
          const side = who === "mine" ? me : them;
          const s = m[side];
          const hit = fx?.target === side;
          const lost = m.state === "finished" && m.winner !== side;
          const winner = m.state === "finished" && m.winner === side;
          return (
            <div key={who} className={`br-pet ${who} ${m.turn === side && m.state === "active" ? "active" : ""}`} style={land ? { left: (who === "mine" ? land.l : land.r)[0], top: (who === "mine" ? land.l : land.r)[1] } : undefined}>
              <div className="br-hp"><b>{s.name}</b><span>❤ {hp[side]}</span><i><em style={{ width: `${hp[side]}%` }} /></i>{!s.connected && m.state === "active" && <small>reconnecting…</small>}</div>
              <div className={`br-sticker ${hit && fx?.kind === "splash" ? "soaked" : ""} ${hit && fx?.kind === "puff" ? "giggle" : ""} ${winner ? "cheer" : ""}`}>
                <PetArt sticker={s.sticker} species={s.species} look={s.look} />
                {hit && fx?.kind === "splash" && <img key={fx.id} className="br-fx pop" src={art("br-pop")} alt="" />}
                {hit && fx?.kind === "puff" && <img key={fx.id} className="br-fx dodge" src={art("br-dodge")} alt="" />}
                {lost && <img className="br-fx suds" src={art("br-suds")} alt="" />}
              </div>
            </div>
          );
        })}

        <Launcher m={m} fx={fx} at={land?.g} />
        {land && fx && (() => {
          // The bubble flies from the launcher's mouth to the pet it was aimed at.
          const to = fx.target === me ? land.l : land.r;
          const from: [number, number] = [land.g[0], land.g[1] - land.gunW * 0.72];
          const style = { left: from[0], top: from[1], "--tx": `${to[0] - from[0]}px`, "--ty": `${to[1] - land.stk * 0.55 - from[1]}px` } as React.CSSProperties;
          return <img key={`s${fx.id}`} className={`shot2 ${fx.kind}`} style={style} src={art(fx.kind === "splash" ? "br-bubble" : "br-puff")} alt="" />;
        })()}
        {won && <div className="confetti">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${(i * 7.3) % 100}%`, animationDelay: `${(i % 7) * 120}ms` }} />)}</div>}
      </div>

      {m.state === "active" && (
        <div className="br-actions">
          <button className="br-btn me" disabled={!myTurn || busy} onClick={() => act("self")}><b>🎲 Splash myself</b><small>Empty = 2 extra shots!</small></button>
          <button className="br-btn them" disabled={!myTurn || busy} onClick={() => act("opponent")}><b>💦 Splash {theirs.name}!</b><small>{m.splashesLeft} loaded of {m.slotsLeft} left</small></button>
        </div>
      )}
      {m.state === "invited" && <div className="br-note panel">Waiting for {theirs.name}'s owner to accept…</div>}
      {finished && (
        <div className="br-note panel col">
          {m.state === "finished"
            ? <Ribbon className="br-ribbon" tone={won ? "gold" : "purple"} crown={won} text={won ? "You win!" : `${m[m.winner ?? them].name} wins`} />
            : <b style={{ fontSize: 20 }}>No match</b>}
          <span className="small">{m.reason}</span>
          {m.state === "finished" && m.mode !== "practice" && (m.loot ? <Loot m={m} won={won} /> : <span className="small muted">Counting the spoils…</span>)}
          {m.state === "finished" && <span className="small muted">{theirs.ownerId === "bot:bandit-practice" ? (won ? "Great job! Practice complete." : "Practice match — no HP lost. Coach Kiki will challenge you again in a moment!") : `Battle HP carries back to your pet. Match #${m.id.slice(3, 9)}`}</span>}
          <button className="br-btn them" onClick={close}><b>Back to the world</b></button>
        </div>
      )}
      <p className="br-rules small">{BUBBLE.slots} bubbles, {BUBBLE.loaded} loaded, order hidden · a soak costs {BUBBLE.splashHp} HP · an empty self-splash gives 2 extra shots</p>
      {rulesOpen && m.state !== "invited" && <RulesCard m={m} onClose={() => setRulesOpen(false)} />}
    </div>
  );
}

function Launcher({ m, fx, at }: { m: BubbleMatchView; fx: Fx | null; at?: [number, number] }) {
  const used = BUBBLE.slots - m.slotsLeft;
  const shoot = fx ? (fx.target === (m.you ?? "a") ? "left" : "right") : null;
  return (
    <div className={`launcher ${fx ? "firing" : ""}`} style={at ? { left: at[0], top: at[1] } : undefined}>
      <img className="launcher-art" src={art("br-launcher-idle")} alt="Bubble launcher" draggable={false} />
      <div className="chambers" aria-label={`${m.slotsLeft} slots left`}>
        {Array.from({ length: BUBBLE.slots }, (_, i) => <img key={i} src={art(i < used ? "br-empty" : "br-loaded")} alt="" className={i < used ? "gone" : ""} />)}
      </div>
      <div className="launcher-info"><b>{m.slotsLeft}</b> slots · <b>{m.splashesLeft}</b> splash{m.splashesLeft === 1 ? "" : "es"}</div>
      {fx?.kind === "splash" && <img key={fx.id} className={`shot ${shoot}`} src={art("br-bubble")} alt="" />}
      {fx?.kind === "puff" && <img key={fx.id} className={`shot puff ${shoot}`} src={art("br-puff")} alt="" />}
      {fx?.reload && <span key={`r${fx.id}`} className="reload">reloaded!</span>}
    </div>
  );
}

function Loot({ m, won }: { m: BubbleMatchView; won: boolean }) {
  const l = m.loot!;
  const items = RESOURCES.filter((r) => l.items[r] > 0);
  const nothing = l.coins === "0" && !items.length;
  return (
    <div className={`br-loot ${won ? "won" : "lost"}`}>
      <b>{nothing ? "Nothing to take this time" : won ? "Spoils!" : "They took…"}</b>
      {!nothing && <span>{l.coins !== "0" && <em>🪙 {fmt(l.coins)}</em>}{items.map((r) => <em key={r}>{l.items[r]} {RESOURCE_LABEL[r].toLowerCase()}</em>)}</span>}
      <small>{(l.shareBps / 100).toFixed(1)}% share{l.fee !== "0" ? ` · ${fmt(l.fee)} fee to HQ` : ""}</small>
    </div>
  );
}

/** How to play — shown at the start of every match (and from the "?" button). */
function RulesCard({ m, onClose }: { m: BubbleMatchView; onClose: () => void }) {
  const s = ECONOMY.battle.stake;
  const stakes = m.mode === "practice" ? "Practice match — nothing is at stake."
    : m.mode === "demo" ? "Demo rival: the winner takes part of the loser's bag (luck helps)."
    : `The winner takes ${s.minShareBps / 100}–${s.maxShareBps / 100}% of the loser's coins and bag — luck decides how much.`;
  return (
    <div className="br-rules-wrap" onClick={onClose}>
      <div className="br-rules-card panel" onClick={(e) => e.stopPropagation()}>
        <h3>How to play</h3>
        <ol>
          <li><span>🫧</span><p>The launcher holds <b>{BUBBLE.slots} bubbles</b> — <b>{BUBBLE.loaded} are loaded</b>. Nobody knows which.</p></li>
          <li><span>💦</span><p>On your turn, splash your rival <i>or</i> yourself. A loaded bubble soaks for <b>{BUBBLE.splashHp} HP</b> — two soaks and you're out!</p></li>
          <li><span>🎲</span><p>Splash yourself and it's empty? <b>You get 2 extra shots!</b></p></li>
          <li><span>🔄</span><p>The launcher only reloads when its loaded bubbles run out.</p></li>
          <li><span>🏆</span><p>{stakes}</p></li>
        </ol>
        <button className="br-btn them" onClick={onClose}><b>Let's play!</b></button>
      </div>
    </div>
  );
}

/**
 * The arena pictures (landscape 1600×900 for PC, portrait 900×1600 for phones, drawn with
 * background-size: cover) each have two pedestals and a paw circle in the middle. Map those
 * picture points to screen pixels so the pets stand on the pedestals and the launcher sits on
 * the paw circle at any screen size.
 */
const STAGES = {
  land: { w: 1600, h: 900, left: [267, 522], right: [1351, 522], gun: [800, 700] },
  port: { w: 900, h: 1600, left: [128, 762], right: [772, 762], gun: [450, 1040] },
} as const;
function useStageLayout(ref: React.RefObject<HTMLDivElement | null>) {
  const [lay, setLay] = useState<{ l: [number, number]; r: [number, number]; g: [number, number]; stk: number; gunW: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const calc = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      const st = W >= H ? STAGES.land : STAGES.port;
      const s = Math.max(W / st.w, H / st.h), ox = (W - st.w * s) / 2, oy = (H - st.h * s) / 2;
      const stk = Math.round(Math.max(84, Math.min(220, 190 * s))), gunW = Math.round(Math.max(110, Math.min(260, 210 * s)));
      const pt = (p: readonly [number, number]): [number, number] => [Math.round(ox + p[0] * s), Math.round(oy + p[1] * s)];
      const half = (stk + 20) / 2 + 6; // the pet card is a bit wider than the sticker
      const clampX = (p: [number, number]): [number, number] => [Math.max(half, Math.min(W - half, p[0])), p[1]];
      setLay({ l: clampX(pt(st.left)), r: clampX(pt(st.right)), g: pt(st.gun), stk, gunW });
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return lay;
}

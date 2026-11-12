/**
 * Bubble Roulette — client view. Pure presentation of the server's match
 * state: the client never knows which slots are loaded, only how many are left.
 */
import { useEffect, useRef, useState } from "react";
import { BUBBLE, type BubbleMatchView } from "@catchami/shared";
import { store, useStore } from "../net/store.ts";
import { send, serverNow } from "../net/api.ts";
import { PetArt } from "./common.tsx";
import { sfx } from "./sfx.ts";

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
        <span className="small muted">from {inv.ownerName} · harmless splash bubbles, HP is the score · {left}s</span>
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
    <div className="br">
      <div className="br-top">
        <span className="br-title">Bubble Roulette</span>
        {m.state === "active" && <span className={`br-turn ${myTurn ? "mine" : ""}`}>{myTurn ? "Your turn" : `${theirs.name}'s turn`} · {secs}s</span>}
        {!finished && <button className="btn sm paper" onClick={() => { if (confirm(m.state === "invited" ? "Withdraw the challenge?" : "Leave the match? Leaving counts as a loss.")) send({ t: "br_forfeit", matchId: m.id }); }}>{m.state === "invited" ? "Cancel" : "Leave"}</button>}
      </div>

      <div className="br-arena">
        {(["mine", "theirs"] as const).map((who) => {
          const side = who === "mine" ? me : them;
          const s = m[side];
          const hit = fx?.target === side;
          const lost = m.state === "finished" && m.winner !== side;
          const winner = m.state === "finished" && m.winner === side;
          return (
            <div key={who} className={`br-pet ${who} ${m.turn === side && m.state === "active" ? "active" : ""}`}>
              <div className="br-hp"><b>{s.name}</b><span>{hp[side]}</span><i><em style={{ width: `${hp[side]}%` }} /></i>{!s.connected && m.state === "active" && <small>reconnecting…</small>}</div>
              <div className={`br-sticker ${hit && fx?.kind === "splash" ? "soaked" : ""} ${hit && fx?.kind === "puff" ? "giggle" : ""} ${winner ? "cheer" : ""}`}>
                <PetArt sticker={s.sticker} species={s.species} look={s.look} />
                {hit && fx?.kind === "splash" && <div className="drops">{Array.from({ length: 7 }, (_, i) => <i key={i} style={{ ["--a" as string]: `${i * 51}deg` }} />)}</div>}
                {lost && <div className="foam">{[[10, 62], [28, 74], [50, 70], [70, 60], [18, 30], [76, 24], [44, 10]].map(([l, t], i) => <i key={i} style={{ left: `${l}%`, top: `${t}%`, animationDelay: `${i * 70}ms` }} />)}</div>}
              </div>
            </div>
          );
        })}

        <Launcher m={m} fx={fx} />
        {won && <div className="confetti">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ left: `${(i * 7.3) % 100}%`, animationDelay: `${(i % 7) * 120}ms` }} />)}</div>}
      </div>

      {m.state === "active" && (
        <div className="br-actions">
          <button className="btn paper" disabled={!myTurn || busy} onClick={() => act("self")}>Splash myself</button>
          <button className="btn coral" disabled={!myTurn || busy} onClick={() => act("opponent")}>Splash {theirs.name}</button>
        </div>
      )}
      {m.state === "invited" && <div className="br-note panel">Waiting for {theirs.name}'s owner to accept…</div>}
      {finished && (
        <div className="br-note panel col">
          <b style={{ fontSize: 20 }}>{m.state === "cancelled" ? "No match" : won ? "You win!" : `${m[m.winner ?? them].name} wins`}</b>
          <span className="small">{m.reason}</span>
          {m.state === "finished" && <span className="small muted">Battle HP carries back to your pet. Match #{m.id.slice(3, 9)} · fair-roll epoch {m.epoch}</span>}
          <button className="btn" onClick={close}>Back to the world</button>
        </div>
      )}
      <p className="br-rules small">6 slots, 2 splash bubbles, positions hidden. A splash costs {BUBBLE.splashHp} HP and reloads the launcher. {BUBBLE.turnMs / 1000}s per turn; two missed turns forfeit. No tokens at stake.</p>
    </div>
  );
}

function Launcher({ m, fx }: { m: BubbleMatchView; fx: Fx | null }) {
  const used = BUBBLE.slots - m.slotsLeft;
  const shoot = fx ? (fx.target === (m.you ?? "a") ? "left" : "right") : null;
  return (
    <div className={`launcher ${fx ? "firing" : ""}`}>
      <svg viewBox="0 0 160 120" width="160" height="120" aria-label="Bubble launcher">
        {/* Body: a chubby toy bubble blower — original design */}
        <ellipse cx="80" cy="104" rx="46" ry="8" fill="rgba(43,29,58,0.2)" />
        <rect x="40" y="52" width="80" height="44" rx="22" fill="#2b1d3a" />
        <rect x="43" y="55" width="74" height="38" rx="19" fill="#7fd5e6" />
        <rect x="50" y="60" width="30" height="8" rx="4" fill="#c8f1ff" />
        {/* Wand rings on both sides */}
        <circle cx="30" cy="74" r="14" fill="none" stroke="#2b1d3a" strokeWidth="7" /><circle cx="30" cy="74" r="14" fill="none" stroke="#ff8fc8" strokeWidth="3.5" />
        <circle cx="130" cy="74" r="14" fill="none" stroke="#2b1d3a" strokeWidth="7" /><circle cx="130" cy="74" r="14" fill="none" stroke="#ff8fc8" strokeWidth="3.5" />
        {/* Drum with six slots: used slots are empty dents, the rest are mystery bubbles */}
        <g className="drum" style={{ transformOrigin: "80px 40px" }}>
          <circle cx="80" cy="40" r="30" fill="#2b1d3a" />
          <circle cx="80" cy="40" r="27" fill="#fff6e5" />
          {Array.from({ length: BUBBLE.slots }, (_, i) => {
            const ang = (i / BUBBLE.slots) * Math.PI * 2 - Math.PI / 2;
            const x = 80 + Math.cos(ang) * 17, y = 40 + Math.sin(ang) * 17;
            const gone = i < used;
            return <circle key={i} cx={x} cy={y} r="7" fill={gone ? "#e2d6c2" : "#bfe9ff"} stroke="#2b1d3a" strokeWidth="2.5" strokeDasharray={gone ? "3 3" : undefined} />;
          })}
          <circle cx="80" cy="40" r="5" fill="#ffd166" stroke="#2b1d3a" strokeWidth="2.5" />
        </g>
      </svg>
      <div className="launcher-info"><b>{m.slotsLeft}</b> slots · <b>{m.splashesLeft}</b> splash{m.splashesLeft === 1 ? "" : "es"}</div>
      {fx?.kind === "splash" && <span key={fx.id} className={`shot bubble ${shoot}`} />}
      {fx?.kind === "puff" && <span key={fx.id} className={`shot puff ${shoot}`} />}
      {fx?.reload && <span key={`r${fx.id}`} className="reload">reloaded!</span>}
    </div>
  );
}

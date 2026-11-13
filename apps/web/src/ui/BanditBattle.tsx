/**
 * Bandit battle: a quick attack minigame. A marker sweeps across a bar; tap
 * ATTACK while it is inside the red target zone. Three attacks — every hit
 * knocks a chunk off the bandit's HP and improves the odds. The server settles
 * the fight and sends the result, shown here too.
 */
import { useEffect, useRef, useState } from "react";
import { controlledPet, store, useStore } from "../net/store.ts";
import { send } from "../net/api.ts";
import { PetArt } from "./common.tsx";
import { sfx } from "./sfx.ts";
import { banditArt, genUrl } from "../game/assets.ts";

type Phase = "intro" | "play" | "wait" | "result";

export function BanditFightPopup() {
  const duel = useStore((s) => s.banditDuel);
  const fight = useStore((s) => s.banditFight);
  const pet = useStore(controlledPet);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [round, setRound] = useState(0);
  const [hits, setHits] = useState(0);
  const [pop, setPop] = useState<{ hit: boolean; k: number } | null>(null);
  const [zone, setZone] = useState(0.5);
  const markerRef = useRef<HTMLSpanElement>(null);
  const pos = useRef(0);
  const sentRef = useRef(false);
  const busy = useRef(false);
  const hitsRef = useRef(0);
  const total = duel?.rounds ?? 3;
  const width = duel?.practice ? 0.3 : 0.22;

  const submit = (h: number) => {
    if (!duel || sentRef.current) return;
    sentRef.current = true;
    send({ t: "duel_input", duelId: duel.duelId, hits: h });
    setPhase("wait");
  };

  // A new battle starts.
  useEffect(() => {
    if (!duel) return;
    sentRef.current = false; hitsRef.current = 0; busy.current = false;
    setHits(0); setRound(0); setPop(null); setZone(0.25 + Math.random() * 0.5);
    setPhase("intro"); sfx.whoosh();
    const t = setTimeout(() => setPhase("play"), 1100);
    const dead = setTimeout(() => submit(hitsRef.current), duel.deadlineMs);
    return () => { clearTimeout(t); clearTimeout(dead); };
  }, [duel?.duelId]);

  // The result arrives (from a battle we played, or one that resolved on its own).
  useEffect(() => {
    if (!fight || fight.quiet) return; // Bubble Roulette already showed this result
    setPhase("result");
    if (fight.won) sfx.fanfare(); else sfx.bad();
    const t = setTimeout(() => { setPhase(null); store.set({ banditDuel: null }); }, 3400);
    return () => clearTimeout(t);
  }, [fight?.at]);

  // Sweep the marker (gets faster each round).
  useEffect(() => {
    if (phase !== "play") return;
    let raf = 0;
    const t0 = performance.now();
    const speed = (duel?.practice ? 0.75 : 0.95) + round * 0.25; // sweeps per second
    const loop = (t: number) => {
      const ph = ((t - t0) / 1000) * speed;
      pos.current = Math.abs(((ph % 2) + 2) % 2 - 1); // 0..1..0 ping-pong
      if (markerRef.current) markerRef.current.style.left = `${pos.current * 100}%`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [phase, round]);

  const attack = () => {
    if (phase !== "play" || busy.current) return;
    busy.current = true;
    const hit = Math.abs(pos.current - zone) <= width / 2;
    if (hit) { hitsRef.current++; setHits(hitsRef.current); sfx.perfect(); } else sfx.miss();
    setPop({ hit, k: Date.now() });
    const next = round + 1;
    setTimeout(() => {
      busy.current = false;
      setPop(null);
      if (next >= total) submit(hitsRef.current);
      else { setRound(next); setZone(0.2 + Math.random() * 0.6); }
    }, 650);
  };

  // Space / Enter attack too.
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); attack(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (!phase) return null;
  const name = duel?.banditName ?? fight?.banditName ?? "Rival";
  const petName = duel?.petName ?? fight?.petName ?? "";
  const banditHp = Math.max(0, 1 - hits / total);
  const won = phase === "result" && fight?.won;
  const lost = phase === "result" && fight && !fight.won;
  return (
    <div className={`bduel ${phase} ${won ? "won" : ""} ${lost ? "lost" : ""}`} onClick={() => { if (phase === "result") { setPhase(null); store.set({ banditDuel: null }); } }}>
      <div className="bduel-card panel">
        <div className="bduel-title">{phase === "result" ? (won ? "🏆 Victory!" : "💫 Defeated…") : duel?.brave ? "⚔️ Battle!" : `⚔️ ${duel?.banditName ?? "A Keeper"} challenges you!`}</div>
        <div className="bduel-arena">
          <div className={`bduel-side pet ${pop?.hit ? "lunge" : ""}`}>
            <div className="bduel-art">{pet ? <PetArt sticker={pet.sticker} species={pet.species} look={pet.look} /> : null}</div>
            <b>{petName}</b>
          </div>
          <span className="bduel-vs">VS</span>
          <div className={`bduel-side bandit ${pop?.hit ? "ouch" : pop ? "dodge" : ""}`}>
            <BanditPortrait id={duel?.banditId ?? fight?.banditId ?? name} />
            <b>{name}</b>
            <span className="bduel-hp"><i style={{ width: `${(phase === "result" && won ? 0 : banditHp) * 100}%` }} /></span>
          </div>
          {pop && <span key={pop.k} className={`bduel-pop ${pop.hit ? "hit" : "miss"}`}>{pop.hit ? "💥 HIT!" : "MISS"}</span>}
        </div>
        {(phase === "intro" || phase === "play") && (
          <>
            <div className="bduel-rounds">{Array.from({ length: total }, (_, i) => <i key={i} className={i < round ? "done" : i === round ? "now" : ""} />)}</div>
            <div className="bduel-bar">
              <span className="bduel-zone" style={{ left: `${(zone - width / 2) * 100}%`, width: `${width * 100}%` }} />
              <span ref={markerRef} className="bduel-marker" />
            </div>
            <button className="bduel-attack" onPointerDown={(e) => { e.preventDefault(); attack(); }} disabled={phase !== "play"}>
              <span>{phase === "intro" ? "GET READY…" : "⚔️ ATTACK!"}</span>
            </button>
            <p className="bduel-hint">Tap when the marker is in the red zone · {hits} hit{hits === 1 ? "" : "s"}</p>
          </>
        )}
        {phase === "wait" && <p className="bduel-wait">{hits} of {total} hits landed… <span className="spinner sm" /></p>}
        {phase === "result" && fight && (
          <div className="bduel-result">
            {fight.won ? `${fight.petName} wins the battle!` : fight.stolen ? `${name} won and took ${fight.stolen}!` : name === "Coach Kiki" ? "Coach Kiki won this round — she'll challenge you again!" : `${name} won — luckily your bag was empty!`}
          </div>
        )}
      </div>
    </div>
  );
}

/** The bandit's pet sticker (mirrored to face the pet) with a mask drawn over its eyes. */
function BanditPortrait({ id }: { id: string }) {
  const a = banditArt(id);
  // Where the sticker lands inside the square slot (object-fit: contain), in % of the slot.
  const w = a.aspect < 1 ? a.aspect * 100 : 100, h = a.aspect < 1 ? 100 : 100 / a.aspect;
  const x0 = (100 - w) / 2, y0 = (100 - h) / 2;
  void x0; void y0; void h;
  return (
    <div className="bduel-art bandit-art">
      <img src={genUrl(a.key)} alt="" />
    </div>
  );
}

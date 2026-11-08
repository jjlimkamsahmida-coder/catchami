/**
 * Catch flow. The on-device model only drives the live reticle; the server
 * re-runs detection on the uploaded frames and is the only authority.
 * Money is never taken for: no animal, unclear photo, duplicates, expired
 * captures, missed throws, or any server/network error.
 */
import { useEffect, useRef, useState } from "react";
import { RARITY_LABEL, type CatchQuote, type CatchTier, type Rarity } from "@catchami/shared";
import { store, toast, useStore } from "../net/store.ts";
import { api, ApiError, refreshWallet } from "../net/api.ts";
import * as art from "../game/art.ts";
import { fmt, Icon, pct } from "./common.tsx";
import { CollectorCard } from "./CollectorCard.tsx";
import { CUBE, genUrl } from "../game/assets.ts";

type Box = [number, number, number, number];
type Stage =
  | { k: "camera" }
  | { k: "checking" }
  | { k: "rejected"; message: string }
  | { k: "choose"; attemptId: string; species: string; quotes: CatchQuote[]; still: string; bbox: Box; frame: { w: number; h: number }; expiresAt: number; sticker: string | null }
  | { k: "throw"; attemptId: string; tier: CatchTier; quote: CatchQuote; still: string; bbox: Box; frame: { w: number; h: number }; sticker: string | null; species: string }
  | { k: "rolling"; still: string; at: { x: number; y: number }; sticker: string | null }
  | { k: "result"; success: boolean; rarity: Rarity | null; petId: string | null; cost: string; label: string; epoch: number; still: string; sticker: string | null; species: string };

interface Coco { detect(v: HTMLVideoElement, max?: number, min?: number): Promise<Array<{ class: string; score: number; bbox: Box }>> }
let modelPromise: Promise<Coco> | null = null;
async function loadModel(): Promise<Coco> {
  modelPromise ??= (async () => {
    const tf = await import("@tensorflow/tfjs");
    await tf.ready();
    const coco = await import("@tensorflow-models/coco-ssd");
    return (await coco.load({ base: "lite_mobilenet_v2", modelUrl: "/models/ssdlite_mobilenet_v2/model.json" })) as unknown as Coco;
  })();
  return modelPromise;
}

/** CamiCube pose image (generated art), with the procedural charm as a fallback. */
const cubeSrc = (pose: keyof typeof CUBE) => genUrl(CUBE[pose]);
const fallbackCube = (() => { let u = ""; return () => (u ||= art.capsule().toDataURL()); })();
function Cube({ pose, style, className = "capsule", ...rest }: { pose: keyof typeof CUBE; style?: React.CSSProperties; className?: string } & React.HTMLAttributes<HTMLImageElement>) {
  return <img className={className} src={cubeSrc(pose)} onError={(e) => { (e.target as HTMLImageElement).src = fallbackCube(); }} alt="CamiCube" draggable={false} style={style} {...rest} />;
}

export function CatchScreen() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>({ k: "camera" });
  const [camError, setCamError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<"loading" | "ready" | "failed">("loading");
  const [live, setLive] = useState<{ box: Box; cls: string; score: number; streak: number } | null>(null);
  const wallet = useStore((s) => s.wallet);
  const close = () => store.set({ screen: "world" });

  // Camera.
  useEffect(() => {
    let stopped = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCamError(window.isSecureContext ? "This browser can't open the camera." : "The camera needs a secure (https) connection."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => { if (stopped) { s.getTracks().forEach((t) => t.stop()); return; } streamRef.current = s; if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play(); } })
      .catch((e: DOMException) => setCamError(e.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access to catch animals." : e.name === "NotFoundError" ? "No camera found on this device. Catching needs a live camera." : `Camera unavailable (${e.name}).`));
    loadModel().then(() => setModelState("ready")).catch(() => setModelState("failed"));
    return () => { stopped = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // Live detection loop (preview only).
  useEffect(() => {
    if (stage.k !== "camera" || modelState !== "ready") return;
    let alive = true;
    const loop = async () => {
      const v = videoRef.current;
      if (!alive) return;
      if (v && v.readyState >= 2) {
        const model = await loadModel();
        const preds = await model.detect(v, 6, 0.4).catch(() => []);
        const best = preds.filter((p) => p.class === "cat" || p.class === "dog").sort((a, b) => b.score - a.score)[0];
        setLive((prev) => (best ? { box: best.bbox, cls: best.class, score: best.score, streak: prev && prev.cls === best.class ? prev.streak + 1 : 1 } : null));
      }
      if (alive) setTimeout(loop, 220);
    };
    void loop();
    return () => { alive = false; };
  }, [stage.k, modelState]);

  const grabFrame = (): { b64: string; url: string; w: number; h: number } => {
    const v = videoRef.current!;
    const scale = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL("image/jpeg", 0.85);
    return { b64: url.split(",")[1]!, url, w, h };
  };

  const check = async () => {
    setStage({ k: "checking" });
    const frames: Array<ReturnType<typeof grabFrame>> = [];
    for (let i = 0; i < 3; i++) { frames.push(grabFrame()); await new Promise((r) => setTimeout(r, 180)); }
    try {
      const r = await api("/api/catch/validate", { frames: frames.map((f) => f.b64) });
      if (!r.ok) { setStage({ k: "rejected", message: r.message }); return; }
      const f = frames[0]!;
      const box: Box = live ? scaleBox(live.box, videoRef.current!, f.w) : [f.w * 0.3, f.h * 0.3, f.w * 0.4, f.h * 0.4];
      setStage({ k: "choose", attemptId: r.attemptId, species: r.species, quotes: r.quotes, still: f.url, bbox: box, frame: { w: f.w, h: f.h }, expiresAt: r.expiresAt, sticker: r.sticker ?? null });
    } catch (e) {
      setStage({ k: "rejected", message: `${(e as Error).message} Nothing was charged.` });
    }
  };

  return (
    <div className="catch">
      <video ref={videoRef} playsInline muted style={{ display: stage.k === "camera" || stage.k === "checking" ? "block" : "none" }} />
      {"still" in stage && <img src={stage.still} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      <div className="top">
        <button className="btn paper sm" onClick={close} aria-label="Close"><Icon name="close" /></button>
        <div className="chip"><span className="coin" style={{ width: 22, height: 22, borderRadius: 99, background: "var(--sun)", border: "2px solid var(--ink)", display: "inline-block" }} /> {fmt(wallet?.available)}</div>
      </div>

      {stage.k === "camera" && (
        <>
          {live && videoRef.current && <Reticle box={live.box} video={videoRef.current} />}
          <div className="status panel" style={{ padding: "6px 14px", fontWeight: 600 }}>
            {camError ?? (modelState === "loading" ? "Warming up animal finder…" : modelState === "failed" ? "Live preview unavailable — you can still try a check" : live ? `${live.cls === "cat" ? "Cat" : "Dog"} spotted!` : "Point at a real cat or dog")}
          </div>
          <div className="bottom col" style={{ alignItems: "center" }}>
            <Cube pose={live && live.streak >= 2 ? "excited" : "happy"} className="" style={{ width: 92, height: 92, objectFit: "contain", animation: live && live.streak >= 2 ? "cubehop 0.5s ease-in-out infinite" : "cubebob 2.4s ease-in-out infinite", filter: "drop-shadow(0 6px 0 rgba(43,29,58,0.35))" }} />
            <button className="btn coral" style={{ minWidth: 220, fontSize: 18 }} disabled={!!camError || (modelState === "ready" && (!live || live.streak < 2))} onClick={check}>
              {live && live.streak >= 2 ? "Lock on" : "Find an animal"}
            </button>
            <p className="panel small" style={{ padding: "6px 10px", margin: 0, textAlign: "center", maxWidth: 360 }}>Checking an animal is free. You only choose and pay for a catch attempt after Catchami confirms a real, eligible animal.</p>
          </div>
        </>
      )}
      {stage.k === "checking" && <div className="status panel" style={{ padding: "8px 16px", fontWeight: 600 }}>Checking the animal…</div>}
      {stage.k === "rejected" && (
        <div className="bottom"><div className="panel col" style={{ padding: 16 }}>
          <h3>Not a valid capture</h3>
          <p style={{ margin: 0 }}>{stage.message}</p>
          <p className="small muted" style={{ margin: 0 }}>Nothing was charged.</p>
          <button className="btn" onClick={() => setStage({ k: "camera" })}>Try again</button>
        </div></div>
      )}
      {stage.k === "choose" && <TierPicker stage={stage} onPick={(tier) => setStage({ k: "throw", attemptId: stage.attemptId, tier, quote: stage.quotes.find((q) => q.tier === tier)!, still: stage.still, bbox: stage.bbox, frame: stage.frame, sticker: stage.sticker, species: stage.species })} onCancel={() => setStage({ k: "camera" })} />}
      {stage.k === "throw" && <Throw stage={stage} onResolved={setStage} />}
      {stage.k === "rolling" && <CaptureSequence at={stage.at} sticker={stage.sticker} />}
      {stage.k === "result" && <Result stage={stage} onAgain={() => setStage({ k: "camera" })} />}
      <style>{`@keyframes wobble { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-18deg) } 75% { transform: rotate(18deg) } } @keyframes cubebob { 50% { transform: translateY(-6px) } } @keyframes cubehop { 50% { transform: translateY(-14px) scale(1.06) } } @keyframes cubespin { to { transform: rotate(360deg) } } @keyframes cubepop { from { transform: scale(0.6) } to { transform: scale(1) } } @keyframes suckin { to { transform: translateY(150px) scale(0.05) rotate(25deg); opacity: 0.2 } } @keyframes pulse { to { transform: scale(1.15); opacity: 0.7 } }`}</style>
    </div>
  );
}

function scaleBox(b: Box, v: HTMLVideoElement, frameW: number): Box {
  const k = frameW / v.videoWidth;
  return [b[0] * k, b[1] * k, b[2] * k, b[3] * k];
}

/** Map a box in source-image pixels to screen pixels for an object-fit: cover element. */
function toScreen(b: Box, srcW: number, srcH: number) {
  const W = window.innerWidth, H = window.innerHeight;
  const s = Math.max(W / srcW, H / srcH);
  const ox = (W - srcW * s) / 2, oy = (H - srcH * s) / 2;
  return { left: ox + b[0] * s, top: oy + b[1] * s, width: b[2] * s, height: b[3] * s };
}

function Reticle({ box, video }: { box: Box; video: HTMLVideoElement }) {
  return <div className="reticle" style={toScreen(box, video.videoWidth, video.videoHeight)} />;
}

function TierPicker({ stage, onPick, onCancel }: { stage: Extract<Stage, { k: "choose" }>; onPick: (t: CatchTier) => void; onCancel: () => void }) {
  const [tier, setTier] = useState<CatchTier>("basic");
  const wallet = useStore((s) => s.wallet);
  const q = stage.quotes.find((x) => x.tier === tier)!;
  const afford = wallet ? BigInt(wallet.available) >= BigInt(q.cost) : false;
  const left = Math.max(0, Math.round((stage.expiresAt - Date.now()) / 60000));
  return (
    <div className="bottom">
      <div className="panel col" style={{ padding: 14, gap: 10, maxHeight: "72vh", overflow: "auto" }}>
        <div className="row">
          {stage.sticker && <img src={stage.sticker} alt="" style={{ width: 64, height: 64, objectFit: "contain" }} />}
          <h3 className="grow">Real {stage.species} confirmed!</h3><span className="small muted">{left} min to throw</span>
        </div>
        <div className="col" style={{ gap: 8 }}>
          {stage.quotes.map((x) => (
            <button key={x.tier} className={`card tier ${tier === x.tier ? "on" : ""}`} onClick={() => setTier(x.tier)}>
              <div className="row"><b className="grow" style={{ textTransform: "capitalize" }}>{x.tier} CamiCube</b><b className="num">{fmt(x.cost)}</b></div>
              <div className="small">Catch chance <b>{pct(x.successPpm)}</b></div>
              <div className="odds">{(Object.keys(x.rarityPpm) as Rarity[]).map((r) => <span key={r}>{RARITY_LABEL[r]} <b>{pct(x.rarityPpm[r])}</b></span>)}</div>
            </button>
          ))}
        </div>
        <div className="notice small">
          <b>If caught:</b> {fmt(q.split.pet)} goes into your new pet's balance, {fmt(q.split.hq)} to HQ, {fmt(q.split.team)} to the team.<br />
          <b>If it escapes:</b> the full {fmt(q.failedToHq)} goes to HQ and no NFT is created.<br />
          A missed throw costs nothing — you can throw again. Rarity odds apply after a successful catch; Mythic is never guaranteed.
        </div>
        <div className="row">
          <button className="btn paper" onClick={onCancel}>Back</button>
          <button className="btn coral grow" disabled={!afford} onClick={() => onPick(tier)}>{afford ? `Throw ${tier} CamiCube · ${fmt(q.cost)}` : "Not enough tokens"}</button>
        </div>
      </div>
    </div>
  );
}

function Throw({ stage, onResolved }: { stage: Extract<Stage, { k: "throw" }>; onResolved: (s: Stage) => void }) {
  const target = toScreen(stage.bbox, stage.frame.w, stage.frame.h);
  const start = { x: window.innerWidth / 2, y: window.innerHeight - 140 };
  const [pos, setPos] = useState(start);
  const [flying, setFlying] = useState(false);
  const [hint, setHint] = useState("Drag the CamiCube and flick it at the animal");
  const drag = useRef<{ id: number; pts: Array<{ x: number; y: number; t: number }> } | null>(null);
  const nonce = useRef(Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20));

  const release = async (vx: number, vy: number) => {
    if (vy > -0.3) { setPos(start); setHint("Flick upward toward the animal"); return; }
    setFlying(true);
    // Ballistic-ish flight: distance from flick speed.
    const speed = Math.hypot(vx, vy);
    const dist = Math.min(window.innerHeight * 0.9, speed * 420);
    const land = { x: pos.x + (vx / speed) * dist, y: pos.y + (vy / speed) * dist };
    const steps = 22;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps;
      setPos({ x: pos.x + (land.x - pos.x) * k, y: pos.y + (land.y - pos.y) * k - Math.sin(k * Math.PI) * 120 });
      await new Promise((r) => setTimeout(r, 16));
    }
    const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
    const rx = Math.max(60, target.width * 0.6), ry = Math.max(60, target.height * 0.6);
    const hit = ((land.x - cx) / rx) ** 2 + ((land.y - cy) / ry) ** 2 <= 1;
    if (!hit) {
      setHint("Missed! No charge — throw again");
      setFlying(false);
      setPos(start);
      return;
    }
    onResolved({ k: "rolling", still: stage.still, at: land, sticker: stage.sticker });
    const t0 = Date.now();
    try {
      const r = await submit(stage.attemptId, stage.tier, nonce.current);
      await new Promise((res) => setTimeout(res, Math.max(0, 3300 - (Date.now() - t0))));
      onResolved({ k: "result", success: r.success, rarity: r.rarity, petId: r.petId, cost: r.cost, label: r.fairness?.label ?? `${stage.attemptId}:${nonce.current}`, epoch: r.fairness?.epoch ?? r.epoch_id, still: stage.still, sticker: stage.sticker, species: stage.species });
      void refreshWallet();
    } catch (e) {
      toast("bad", (e as Error).message);
      onResolved(stage);
    }
  };

  return (
    <>
      <div className="reticle" style={{ ...target, borderStyle: "dashed" }} />
      <div className="status panel" style={{ padding: "6px 14px", fontWeight: 600 }}>{hint}</div>
      <Cube pose={flying ? "fly" : "happy"}
        style={{ left: pos.x - 48, top: pos.y - 48, width: 96, height: 96, objectFit: "contain", transition: flying ? "none" : "left 0.15s, top 0.15s", animation: flying ? "cubespin 0.35s linear infinite" : undefined }}
        onPointerDown={(e) => { if (flying) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] }; }}
        onPointerMove={(e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; d.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() }); if (d.pts.length > 6) d.pts.shift(); setPos({ x: e.clientX, y: e.clientY }); }}
        onPointerUp={(e) => {
          const d = drag.current; drag.current = null;
          if (!d || d.pts.length < 2) return;
          const a = d.pts[0]!, b = d.pts[d.pts.length - 1]!;
          const dt = Math.max(16, b.t - a.t);
          void release((b.x - a.x) / dt, (b.y - a.y) / dt);
          void e;
        }} />
      <div className="bottom"><p className="panel small" style={{ margin: 0, padding: "6px 10px", textAlign: "center" }}>{stage.tier} CamiCube · {fmt(stage.quote.cost)} · {pct(stage.quote.successPpm)} catch chance</p></div>
    </>
  );
}

/** Resolve the paid attempt. If the response is lost, look the attempt up instead of guessing. */
async function submit(attemptId: string, tier: CatchTier, clientNonce: string) {
  try {
    return await api("/api/catch/attempt", { attemptId, tier, clientNonce });
  } catch (e) {
    if (e instanceof ApiError && (e.code === "resolved" || e.code === "network" || e.code === "internal")) {
      const a = await api(`/api/catch/attempt/${attemptId}`);
      if (a.status === "caught" || a.status === "failed") return { success: a.success, rarity: a.rarity, petId: a.pet_id, cost: a.cost, fairness: { label: `${attemptId}:${a.client_nonce}`, epoch: a.epoch_id } };
    }
    throw e;
  }
}

/** Unfold → the animal is pulled in → the cube wobbles shut three times. */
function CaptureSequence({ at, sticker }: { at: { x: number; y: number }; sticker: string | null }) {
  const [phase, setPhase] = useState<"open" | "wobble">("open");
  useEffect(() => { const t = setTimeout(() => setPhase("wobble"), 1100); return () => clearTimeout(t); }, []);
  return (
    <>
      {phase === "open" && sticker && <img src={sticker} alt="" style={{ position: "absolute", left: at.x - 70, top: at.y - 190, width: 140, height: 140, objectFit: "contain", zIndex: 4, animation: "suckin 1.05s cubic-bezier(.6,0,.9,.4) forwards" }} />}
      {phase === "open" && <div style={{ position: "absolute", left: at.x - 90, top: at.y - 110, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,226,120,0.85), rgba(255,226,120,0) 70%)", zIndex: 3, animation: "pulse 0.5s ease-in-out infinite alternate" }} />}
      <Cube pose={phase === "open" ? "open" : "wobble"} style={{ left: at.x - 56, top: at.y - 56, width: 112, height: 112, objectFit: "contain", zIndex: 5, animation: phase === "wobble" ? "wobble 0.7s ease-in-out 3" : "cubepop 0.3s ease-out" }} />
    </>
  );
}

function Result({ stage, onAgain }: { stage: Extract<Stage, { k: "result" }>; onAgain: () => void }) {
  const own = useStore((s) => s.own);
  const pet = own.find((p) => p.id === stage.petId);
  return (
    <div className="bottom" style={{ top: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "auto", background: "rgba(43,29,58,0.45)" }}>
      <div className="col" style={{ alignItems: "center", gap: 10, padding: "16px 0" }}>
        {stage.success ? (
          <>
            <div className="row" style={{ gap: 6 }}>
              <Cube pose="excited" className="" style={{ width: 70, height: 70, objectFit: "contain", animation: "cubehop 0.6s ease-in-out 3" }} />
              <h2 style={{ color: "#fff", WebkitTextStroke: "4px #2b1d3a", paintOrder: "stroke fill", fontSize: 30 }}>Caught{pet ? ` ${pet.name}` : ""}!</h2>
            </div>
            <CollectorCard flipIn width={Math.min(300, window.innerWidth - 48)} card={{
              id: stage.petId ?? "pet_new", name: pet?.name ?? "New friend", species: (pet?.species ?? stage.species) as "cat" | "dog", rarity: (stage.rarity ?? "common") as Rarity,
              sticker: pet?.sticker ?? (stage.petId ? `/media/stickers/${stage.petId}.png` : stage.sticker), look: pet?.look ?? { hue: 30, outline: 0, pattern: 0, bounce: 100 },
              stats: pet?.baseStats ?? null, traits: pet?.traits,
            }} />
          </>
        ) : (
          <>
            <Cube pose="dizzy" className="" style={{ width: 130, height: 130, objectFit: "contain", animation: "wobble 0.5s ease-in-out 2" }} />
            <h2 style={{ color: "#fff", WebkitTextStroke: "4px #2b1d3a", paintOrder: "stroke fill", fontSize: 28 }}>It slipped away…</h2>
          </>
        )}
        <div className="panel col" style={{ padding: 14, width: "min(420px, calc(100vw - 28px))" }}>
          {stage.success
            ? <p className="small" style={{ margin: 0 }}>80% of the CamiCube cost is now in your pet's balance. NFT mint is queued for the chain.</p>
            : <p style={{ margin: 0 }}>The CamiCube cost ({fmt(stage.cost)}) went to HQ. No NFT was created.</p>}
          <div className="row" style={{ width: "100%" }}>
            <button className="btn paper grow" onClick={onAgain}>{stage.success ? "Catch another" : "Find another animal"}</button>
            {stage.success && <button className="btn leaf grow" onClick={() => store.set({ screen: "pets", petScreen: stage.petId })}>Meet your pet</button>}
          </div>
          <p className="small muted" style={{ margin: 0 }}>Verify later in Wallet → Fairness · epoch {stage.epoch} · label {stage.label}</p>
        </div>
      </div>
    </div>
  );
}

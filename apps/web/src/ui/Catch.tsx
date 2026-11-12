/**
 * Catch flow: point the camera at a real cat or dog, pick a CamiCube, then
 * throw it (flick, tap the animal, or Space). The throw grabs a short camera
 * burst; the server verifies the animal and, if it's real and eligible,
 * resolves the paid catch in the same motion.
 *
 * The on-device model only drives the live reticle; the server re-runs
 * detection (and an optional vision check) and is the only authority.
 * Nothing is charged for: missed throws, no/unsupported animal, screens or
 * photos, duplicates, or any network/server error.
 */
import { useEffect, useRef, useState } from "react";
import { ECONOMY, RARITY_LABEL, type CatchQuote, type CatchTier, type Rarity } from "@catchami/shared";
import { store, toast, useStore } from "../net/store.ts";
import { api, ApiError, refreshWallet } from "../net/api.ts";
import * as art from "../game/art.ts";
import { fmt, Icon, pct } from "./common.tsx";
import { CollectorCard } from "./CollectorCard.tsx";
import { CUBE, genUrl } from "../game/assets.ts";
import { sfx } from "./sfx.ts";

type Box = [number, number, number, number];
type Frame = { b64: string; url: string; w: number; h: number };
type Stage =
  | { k: "aim" }
  | { k: "flying"; from: Pt; to: Pt }
  | { k: "working"; at: Pt; phase: "checking" | "rolling"; sticker: string | null }
  | { k: "bounced"; at: Pt; message: string }
  | { k: "result"; success: boolean; rarity: Rarity | null; petId: string | null; cost: string; label: string; epoch: number; sticker: string | null; species: string; first: boolean };
type Pt = { x: number; y: number };

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

const cubeSrc = (pose: keyof typeof CUBE) => genUrl(CUBE[pose]);
const fallbackCube = (() => { let u = ""; return () => (u ||= art.capsule().toDataURL()); })();
export function Cube({ pose, style, className = "capsule", ...rest }: { pose: keyof typeof CUBE; style?: React.CSSProperties; className?: string } & React.HTMLAttributes<HTMLImageElement>) {
  return <img className={className} src={cubeSrc(pose)} onError={(e) => { (e.target as HTMLImageElement).src = fallbackCube(); }} alt="CamiCube" draggable={false} style={style} {...rest} />;
}

const TIER_LABEL: Record<CatchTier, string> = { basic: "Basic", enhanced: "Enhanced", premium: "Premium" };

export interface CatchProps {
  /** Guided first catch (onboarding): basic cube, guaranteed success, no tier picker. */
  first?: boolean;
  onClose?: () => void;
  /** Called after a successful catch with the new pet's id. */
  onCaught?: (petId: string) => void;
}

export function CatchScreen({ first = false, onClose, onCaught }: CatchProps = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stage, setStage] = useState<Stage>({ k: "aim" });
  const [camError, setCamError] = useState<string | null>(null);
  const [modelState, setModelState] = useState<"loading" | "ready" | "failed">("loading");
  const [live, setLive] = useState<{ box: Box; cls: string; score: number; streak: number } | null>(null);
  const [quotes, setQuotes] = useState<CatchQuote[] | null>(null);
  const [tier, setTier] = useState<CatchTier>("basic");
  const [hint, setHint] = useState<string | null>(null);
  const wallet = useStore((s) => s.wallet);
  const close = onClose ?? (() => store.set({ screen: "world" }));
  const devPhoto = useRef<Frame[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const allowDevPhoto = new URLSearchParams(location.search).has("devphoto");

  // Camera + model + prices.
  useEffect(() => {
    let stopped = false;
    void api<{ quotes: CatchQuote[] }>("/api/catch/quotes").then((r) => setQuotes(r.quotes)).catch(() => {});
    if (!navigator.mediaDevices?.getUserMedia) { setCamError(window.isSecureContext ? "This browser can't open the camera." : "The camera needs a secure (https) connection."); return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      .then((s) => { if (stopped) { s.getTracks().forEach((t) => t.stop()); return; } streamRef.current = s; if (videoRef.current) { videoRef.current.srcObject = s; void videoRef.current.play(); } })
      .catch((e: DOMException) => setCamError(e.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access to catch animals." : e.name === "NotFoundError" ? "No camera found on this device." : `Camera unavailable (${e.name}).`));
    loadModel().then(() => setModelState("ready")).catch(() => setModelState("failed"));
    return () => { stopped = true; streamRef.current?.getTracks().forEach((t) => t.stop()); };
  }, []);

  // Live detection loop (reticle only — never decides anything).
  useEffect(() => {
    if (stage.k !== "aim" || modelState !== "ready") return;
    let alive = true;
    const loop = async () => {
      const v = videoRef.current;
      if (!alive) return;
      if (v && v.readyState >= 2) {
        const model = await loadModel();
        const preds = await model.detect(v, 6, 0.35).catch(() => []);
        const best = preds.filter((p) => p.class === "cat" || p.class === "dog").sort((a, b) => b.score - a.score)[0];
        setLive((prev) => (best ? { box: best.bbox, cls: best.class, score: best.score, streak: prev && prev.cls === best.class ? prev.streak + 1 : 1 } : null));
      }
      if (alive) setTimeout(loop, 200);
    };
    void loop();
    return () => { alive = false; };
  }, [stage.k, modelState]);

  const grabFrame = (): Frame | null => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const scale = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale), h = Math.round(v.videoHeight * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL("image/jpeg", 0.85);
    return { b64: url.split(",")[1]!, url, w, h };
  };

  const quote = quotes?.find((q) => q.tier === (first ? "basic" : tier)) ?? null;
  const afford = !!(quote && wallet && BigInt(wallet.available) >= BigInt(quote.cost));
  const target = (): { box: { left: number; top: number; width: number; height: number } | null } => {
    const v = videoRef.current;
    return { box: live && v && v.videoWidth ? toScreen(live.box, v.videoWidth, v.videoHeight) : null };
  };
  const start = (): Pt => ({ x: window.innerWidth / 2, y: window.innerHeight - (first ? 150 : 200) });

  /** Throw toward a screen point. The camera burst is taken during the flight. */
  const throwAt = async (to: Pt) => {
    if (stage.k !== "aim") return;
    if (camError && !devPhoto.current) return;
    if (!quote) { setHint("Loading prices…"); return; }
    if (!afford) { setHint(`You need ${fmt(quote.cost)} $CATCHAMI for this cube.`); return; }
    const t = target().box;
    const from = start();
    sfx.whoosh();
    setStage({ k: "flying", from, to });
    const frames: Frame[] = [];
    if (devPhoto.current) frames.push(...devPhoto.current);
    else for (let i = 0; i < 3; i++) { const f = grabFrame(); if (f) frames.push(f); await sleep(130); }
    await sleep(Math.max(0, 480 - frames.length * 130));
    // A visible animal box that the cube clearly missed: free retry.
    if (t) {
      const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
      const rx = Math.max(70, t.width * 0.65), ry = Math.max(70, t.height * 0.65);
      if (((to.x - cx) / rx) ** 2 + ((to.y - cy) / ry) ** 2 > 1) { setStage({ k: "bounced", at: to, message: "Missed! No charge — throw again." }); return; }
    }
    if (frames.length < 2) { setStage({ k: "bounced", at: to, message: "The camera isn't ready yet. Nothing was charged." }); return; }
    setStage({ k: "working", at: to, phase: "checking", sticker: null });
    try {
      const v = await api("/api/catch/validate", { frames: frames.map((f) => f.b64) });
      if (!v.ok) { sfx.bad(); setStage({ k: "bounced", at: to, message: `${v.message} Nothing was charged.` }); return; }
      setStage({ k: "working", at: to, phase: "rolling", sticker: v.sticker ?? null });
      const t0 = Date.now();
      const r = await submit(v.attemptId, first ? "basic" : tier, nonce());
      await sleep(Math.max(0, 3200 - (Date.now() - t0)));
      if (r.success) sfx.win(); else sfx.bad();
      setStage({ k: "result", success: r.success, rarity: r.rarity, petId: r.petId, cost: r.cost, label: r.fairness?.label ?? "", epoch: r.fairness?.epoch ?? 0, sticker: v.sticker ?? null, species: v.species, first: Boolean(r.firstCatch) });
      void refreshWallet();
    } catch (e) {
      setStage({ k: "bounced", at: to, message: `${(e as Error).message} Nothing was charged.` });
    }
  };

  // Mouse / keyboard: Space or Enter throws at the animal (or the centre).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.key === "Enter") && stage.k === "aim") {
        e.preventDefault();
        const t = target().box;
        void throwAt(t ? { x: t.left + t.width / 2, y: t.top + t.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight * 0.42 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const loadDevPhoto = async (file: File) => {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 960 / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const frame = (b: number): Frame => {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const g = c.getContext("2d")!; g.filter = `brightness(${b})`; g.drawImage(img, 0, 0, w, h);
      const url = c.toDataURL("image/jpeg", 0.88);
      return { url, b64: url.split(",")[1]!, w, h };
    };
    devPhoto.current = [frame(1), frame(1.05)];
    setCamError(null);
    setHint("Dev photo loaded — throw the cube.");
  };

  const t = target().box;
  const locked = !!(live && live.streak >= 2);
  return (
    <div className="catch">
      <video ref={videoRef} playsInline muted style={{ display: devPhoto.current ? "none" : "block" }} />
      {devPhoto.current && <img src={devPhoto.current[0]!.url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      <div className="top">
        <button className="btn paper sm" onClick={close} aria-label="Close"><Icon name="close" /></button>
        <div className="grow" />
        <div className="chip"><img src={genUrl("ui-coin")} alt="" style={{ width: 22, height: 22 }} /> {fmt(wallet?.available)}</div>
      </div>

      {stage.k === "aim" && (
        <>
          {t && <div className={`reticle ${locked ? "locked" : ""}`} style={t}><span className="reticle-tag">{live!.cls === "cat" ? "Cat" : "Dog"}{locked ? " · throw!" : ""}</span></div>}
          {/* Tap the photo to throw there (mouse friendly). */}
          <div style={{ position: "absolute", inset: 0, zIndex: 2, cursor: "crosshair" }} onClick={(e) => void throwAt({ x: e.clientX, y: e.clientY })} />
          <div className="status panel catch-status">
            {camError ?? hint ?? (modelState === "loading" ? "Warming up the animal finder…" : locked ? "Got it! Flick or tap to throw" : live ? "Hold steady…" : "Point at a real cat or dog")}
          </div>
          <ThrowCube start={start()} disabled={!!camError && !devPhoto.current} onThrow={(to) => void throwAt(to)} excited={locked} />
          <div className="bottom catch-bottom">
            {first ? (
              <div className="panel catch-note">
                <b>Your first CamiCube always holds!</b> Costs {quote ? fmt(quote.cost) : "…"} from your starter coins — rarity is still a fair roll.
              </div>
            ) : (
              <div className="tier-chips">
                {(quotes ?? []).map((q) => (
                  <button key={q.tier} className={`tier-chip ${tier === q.tier ? "on" : ""}`} onClick={() => setTier(q.tier)}>
                    <b>{TIER_LABEL[q.tier]}</b><span>{fmt(q.cost)}</span><small>{pct(q.successPpm)} catch</small>
                  </button>
                ))}
              </div>
            )}
            {quote && !first && <p className="catch-fine">Caught: {fmt(quote.split.pet)} goes into your pet's piggy bank. Escaped: {fmt(quote.failedToHq)} goes to HQ. Missed throws and invalid photos are free.</p>}
            {allowDevPhoto && (
              <>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadDevPhoto(f); e.target.value = ""; }} />
                <button className="btn paper sm" style={{ alignSelf: "center" }} onClick={() => fileRef.current?.click()}>Dev: load a test photo</button>
              </>
            )}
          </div>
        </>
      )}
      {stage.k === "flying" && <FlyingCube from={stage.from} to={stage.to} />}
      {stage.k === "working" && <CaptureSequence at={stage.at} sticker={stage.sticker} phase={stage.phase} />}
      {stage.k === "bounced" && (
        <>
          <Cube pose="dizzy" style={{ left: stage.at.x - 48, top: stage.at.y - 48, width: 96, height: 96, objectFit: "contain", animation: "cubebounce 0.7s ease-out forwards" }} />
          <div className="bottom"><div className="panel col" style={{ padding: 16 }}>
            <h3 style={{ margin: 0 }}>The cube bounced off</h3>
            <p style={{ margin: 0 }}>{stage.message}</p>
            <button className="btn coral" onClick={() => { setHint(null); setStage({ k: "aim" }); }}>Try again</button>
          </div></div>
        </>
      )}
      {stage.k === "result" && <Result stage={stage} first={first} onAgain={() => setStage({ k: "aim" })} onCaught={onCaught} />}
      <style>{`@keyframes wobble { 0%,100% { transform: rotate(0) } 25% { transform: rotate(-18deg) } 75% { transform: rotate(18deg) } } @keyframes cubebob { 50% { transform: translateY(-6px) } } @keyframes cubehop { 50% { transform: translateY(-14px) scale(1.06) } } @keyframes cubespin { to { transform: rotate(360deg) } } @keyframes cubepop { from { transform: scale(0.6) } to { transform: scale(1) } } @keyframes suckin { to { transform: translateY(150px) scale(0.05) rotate(25deg); opacity: 0.2 } } @keyframes pulse { to { transform: scale(1.15); opacity: 0.7 } } @keyframes cubebounce { 0% { transform: translate(0,0) rotate(0) } 40% { transform: translate(40px,-60px) rotate(120deg) } 100% { transform: translate(90px,140px) rotate(260deg); opacity: 0 } }`}</style>
    </div>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 20);

/** Map a box in source-image pixels to screen pixels for an object-fit: cover element. */
function toScreen(b: Box, srcW: number, srcH: number) {
  const W = window.innerWidth, H = window.innerHeight;
  const s = Math.max(W / srcW, H / srcH);
  const ox = (W - srcW * s) / 2, oy = (H - srcH * s) / 2;
  return { left: ox + b[0] * s, top: oy + b[1] * s, width: b[2] * s, height: b[3] * s };
}

/** The cube in your hand: drag and flick it upward to throw. */
function ThrowCube({ start, disabled, excited, onThrow }: { start: Pt; disabled: boolean; excited: boolean; onThrow: (to: Pt) => void }) {
  const [pos, setPos] = useState<Pt | null>(null);
  const drag = useRef<{ id: number; pts: Array<Pt & { t: number }> } | null>(null);
  const p = pos ?? start;
  return (
    <Cube pose={excited ? "excited" : "happy"}
      style={{ left: p.x - 52, top: p.y - 52, width: 104, height: 104, objectFit: "contain", zIndex: 4, cursor: disabled ? "default" : "grab", touchAction: "none",
        animation: pos ? undefined : excited ? "cubehop 0.5s ease-in-out infinite" : "cubebob 2.4s ease-in-out infinite", filter: "drop-shadow(0 8px 0 rgba(43,29,58,0.35))", opacity: disabled ? 0.5 : 1 }}
      onPointerDown={(e) => { if (disabled) return; e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: performance.now() }] }; }}
      onPointerMove={(e) => { const d = drag.current; if (!d || d.id !== e.pointerId) return; d.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() }); if (d.pts.length > 6) d.pts.shift(); setPos({ x: e.clientX, y: e.clientY }); }}
      onPointerUp={(e) => {
        e.stopPropagation();
        const d = drag.current; drag.current = null; setPos(null);
        if (!d || d.pts.length < 2) return;
        const a = d.pts[0]!, b = d.pts[d.pts.length - 1]!;
        const dt = Math.max(16, b.t - a.t), vx = (b.x - a.x) / dt, vy = (b.y - a.y) / dt;
        if (vy > -0.3) return; // not a flick upward
        const speed = Math.hypot(vx, vy);
        const dist = Math.min(window.innerHeight * 0.85, speed * 420);
        onThrow({ x: b.x + (vx / speed) * dist, y: b.y + (vy / speed) * dist });
      }} />
  );
}

function FlyingCube({ from, to }: { from: Pt; to: Pt }) {
  const [k, setK] = useState(0);
  useEffect(() => {
    let raf = 0; const t0 = performance.now();
    const tick = () => { const v = Math.min(1, (performance.now() - t0) / 460); setK(v); if (v < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 140;
  const size = 104 - 40 * k;
  return <Cube pose="fly" style={{ left: x - size / 2, top: y - size / 2, width: size, height: size, objectFit: "contain", zIndex: 4, animation: "cubespin 0.35s linear infinite" }} />;
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

/** Cube lands → opens → the animal is pulled in → it wobbles shut three times. */
function CaptureSequence({ at, sticker, phase }: { at: Pt; sticker: string | null; phase: "checking" | "rolling" }) {
  const [shut, setShut] = useState(false);
  useEffect(() => { if (phase !== "rolling") return; const t = setTimeout(() => setShut(true), 1100); return () => clearTimeout(t); }, [phase]);
  const open = phase === "rolling" && !shut;
  return (
    <>
      {open && sticker && <img src={sticker} alt="" style={{ position: "absolute", left: at.x - 70, top: at.y - 190, width: 140, height: 140, objectFit: "contain", zIndex: 4, animation: "suckin 1.05s cubic-bezier(.6,0,.9,.4) forwards" }} />}
      {phase === "checking" && <div style={{ position: "absolute", left: at.x - 90, top: at.y - 90, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(140,220,255,0.7), rgba(140,220,255,0) 70%)", zIndex: 3, animation: "pulse 0.5s ease-in-out infinite alternate" }} />}
      {open && <div style={{ position: "absolute", left: at.x - 90, top: at.y - 110, width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(255,226,120,0.85), rgba(255,226,120,0) 70%)", zIndex: 3, animation: "pulse 0.5s ease-in-out infinite alternate" }} />}
      <Cube pose={phase === "checking" ? "excited" : open ? "open" : "wobble"} style={{ left: at.x - 56, top: at.y - 56, width: 112, height: 112, objectFit: "contain", zIndex: 5, animation: shut ? "wobble 0.7s ease-in-out 3" : phase === "checking" ? "cubehop 0.45s ease-in-out infinite" : "cubepop 0.3s ease-out" }} />
      <div className="status panel catch-status">{phase === "checking" ? "Checking the animal…" : shut ? "Wobble… wobble…" : "Cami spark found!"}</div>
    </>
  );
}

function Result({ stage, first, onAgain, onCaught }: { stage: Extract<Stage, { k: "result" }>; first: boolean; onAgain: () => void; onCaught?: (petId: string) => void }) {
  const own = useStore((s) => s.own);
  const pet = own.find((p) => p.id === stage.petId);
  return (
    <div className="bottom full" style={{ top: 0, display: "flex", flexDirection: "column", justifyContent: "flex-end", overflow: "auto", background: "rgba(43,29,58,0.5)" }}>
      <div className="col" style={{ alignItems: "center", gap: 10, padding: "16px 0" }}>
        {stage.success ? (
          <>
            <div className="row" style={{ gap: 6 }}>
              <Cube pose="excited" className="" style={{ width: 70, height: 70, objectFit: "contain", animation: "cubehop 0.6s ease-in-out 3" }} />
              <h2 className="outline-title" style={{ fontSize: 30 }}>Caught!</h2>
            </div>
            <CollectorCard flipIn width={Math.min(300, window.innerWidth - 48)} card={{
              id: stage.petId ?? "pet_new", name: pet?.name ?? "New friend", species: (pet?.species ?? stage.species) as "cat" | "dog", rarity: (stage.rarity ?? "common") as Rarity,
              sticker: pet?.sticker ?? (stage.petId ? `/media/stickers/${stage.petId}.png` : stage.sticker), look: pet?.look ?? { hue: 30, outline: 0, pattern: 0, bounce: 100 },
              stats: pet?.baseStats ?? null, traits: pet?.traits,
            }} />
            <span className="rarity-pill">{RARITY_LABEL[(stage.rarity ?? "common") as Rarity]}</span>
          </>
        ) : (
          <>
            <Cube pose="dizzy" className="" style={{ width: 130, height: 130, objectFit: "contain", animation: "wobble 0.5s ease-in-out 2" }} />
            <h2 className="outline-title" style={{ fontSize: 28 }}>It slipped away…</h2>
          </>
        )}
        <div className="panel col" style={{ padding: 14, width: "min(420px, calc(100vw - 28px))" }}>
          {stage.success
            ? <p className="small" style={{ margin: 0 }}>{stage.first ? "Your first cube held, as promised. " : ""}{pct(ECONOMY.catch.successSplit.pet * 100)} of the cube's cost is now in your pet's piggy bank.</p>
            : <p style={{ margin: 0 }}>The cube's cost ({fmt(stage.cost)}) went to HQ, which pays it back out to players. No NFT was created.</p>}
          <div className="row" style={{ width: "100%" }}>
            {stage.success && onCaught && stage.petId
              ? <button className="btn leaf grow" onClick={() => onCaught(stage.petId!)}>Continue</button>
              : <>
                <button className="btn paper grow" onClick={onAgain}>{stage.success ? "Catch another" : "Try again"}</button>
                {stage.success && !first && <button className="btn leaf grow" onClick={() => store.set({ screen: "pets", petScreen: stage.petId })}>Meet your pet</button>}
              </>}
          </div>
          {stage.label && <p className="small muted" style={{ margin: 0 }}>Verify later in Wallet → Fairness · epoch {stage.epoch} · label {stage.label}</p>}
        </div>
      </div>
    </div>
  );
}

export function toastCatchError(e: unknown) { toast("bad", (e as Error).message); }

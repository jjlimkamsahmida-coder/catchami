/**
 * The new-player journey, played as little story scenes:
 *   intro (the Keeper and the CamiCube) → join (guest or NEAR testnet) →
 *   starter gift → first catch (phone camera, or QR hand-off from a laptop) →
 *   name your pet → how the world works → in-game tutorial.
 * Progress lives on the server (onboarding stage), so phone and laptop agree
 * and a returning player resumes where they left off.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { ECONOMY, formatTokens, tokens } from "@catchami/shared";
import { store, useStore, type OnboardingStage } from "../net/store.ts";
import { adoptSession, api, forgetDevice, refreshWallet, setOnboarding, startAsGuest } from "../net/api.ts";
import { prepareNear, signInWithNear, WALLETS, type WalletId } from "../net/near.ts";
import { nearAuthAvailable, signInWithNearAuth } from "../net/nearauth.ts";
import { CollectorCard, cardFromPet } from "./CollectorCard.tsx";
import { genUrl } from "../game/assets.ts";
import { sfx } from "./sfx.ts";

const CatchScreen = lazy(() => import("./Catch.tsx").then((m) => ({ default: m.CatchScreen })));

const STARTER = formatTokens(tokens(ECONOMY.catch.starterGrantWhole));
const CUBE_COST = formatTokens(ECONOMY.catch.tiers.basic.cost);
export const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

// ------------------------------------------------------------ shared scene bits

/** The Keeper: final art if it exists, otherwise a hooded silhouette with glowing eyes. */
export type KeeperPose = "idle" | "toss" | "wave" | "point";
export function Keeper({ size = 260, reveal = true, cube = true, pose, className = "" }: { size?: number; reveal?: boolean; cube?: boolean; pose?: KeeperPose; className?: string }) {
  const [art, setArt] = useState(true);
  return (
    <div className={`keeper ${reveal ? "revealed" : ""} ${className}`} style={{ width: size, height: size * 1.15 }}>
      {art
        ? <img key={pose ?? "main"} className="keeper-art" src={genUrl(pose ? `keeper-${pose}` : "keeper")} alt="The Keeper" onError={() => setArt(false)} draggable={false} />
        : (
          <svg className="keeper-art" viewBox="0 0 200 230" aria-label="The Keeper">
            <defs>
              <radialGradient id="kglow" cx="50%" cy="40%" r="60%"><stop offset="0" stopColor="#6b4fa0" /><stop offset="1" stopColor="#2b1d3a" /></radialGradient>
            </defs>
            <path d="M100 8 C58 8 40 52 40 92 L28 222 L172 222 L160 92 C160 52 142 8 100 8 Z" fill="url(#kglow)" stroke="#2b1d3a" strokeWidth="6" />
            <path d="M100 30 C72 30 62 62 62 92 C62 118 80 134 100 134 C120 134 138 118 138 92 C138 62 128 30 100 30 Z" fill="#160e22" />
            <ellipse className="keeper-eye" cx="84" cy="94" rx="7" ry="9" fill="#ffe28c" />
            <ellipse className="keeper-eye" cx="116" cy="94" rx="7" ry="9" fill="#ffe28c" />
            <path d="M52 170 Q100 196 148 170" stroke="#4a3570" strokeWidth="8" fill="none" strokeLinecap="round" />
          </svg>
        )}
      {cube && !art && <img className="keeper-cube" src={genUrl("cube-happy")} alt="" draggable={false} />}
    </div>
  );
}

interface Line { who: string; text: string; cue?: "reveal" | "toss" }

/** Typewriter dialogue box. Tap/Space/Enter completes the line, then advances. */
function Dialogue({ lines, onDone, onCue }: { lines: Line[]; onDone: () => void; onCue?: (cue: Line["cue"], i: number) => void }) {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const line = lines[i]!;
  const full = n >= line.text.length;
  useEffect(() => { setN(0); onCue?.(line.cue, i); }, [i]);
  useEffect(() => {
    if (full) return;
    const t = setTimeout(() => { setN((v) => v + 2); if (n % 6 === 0) sfx.type(); }, 22);
    return () => clearTimeout(t);
  }, [n, full]);
  const next = () => {
    if (!full) { setN(line.text.length); return; }
    if (i < lines.length - 1) setI(i + 1); else onDone();
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.code === "Space" || e.key === "Enter") { e.preventDefault(); next(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  return (
    <button className="dialogue" onClick={next}>
      {line.who && <span className="dialogue-name">{line.who}</span>}
      <span className="dialogue-text">{line.text.slice(0, n)}<span className="dialogue-ghost">{line.text.slice(n)}</span></span>
      {full && <span className="dialogue-next">{i < lines.length - 1 ? "▼" : "▶"}</span>}
    </button>
  );
}

export function Scene({ night = false, children, onSkip }: { night?: boolean; children: React.ReactNode; onSkip?: () => void }) {
  return (
    <div className={`scene ${night ? "night" : "day"}`}>
      <div className="scene-bg" />
      {night && <div className="fireflies" aria-hidden>{Array.from({ length: 14 }, (_, k) => <span key={k} style={{ left: `${(k * 37) % 100}%`, top: `${20 + ((k * 53) % 60)}%`, animationDelay: `${(k * 0.7) % 5}s` }} />)}</div>}
      {onSkip && <button className="scene-skip" onClick={onSkip}>Skip ›</button>}
      {children}
    </div>
  );
}

// ------------------------------------------------------------ the journey

export function Journey({ onEnterGame, onExit }: { onEnterGame: () => void; onExit: () => void }) {
  const token = useStore((s) => s.token);
  const onboarding = useStore((s) => s.onboarding);
  const [, force] = useState(() => { if (!store.get().token) localStage = null; return 0; }); // fresh story when opened without an account
  // Without an account the story always starts at the beginning.
  const server = onboarding?.stage ?? "intro";
  // Right after sign-up the server still says "intro" for a moment; keep the local story position.
  const stage: OnboardingStage = !token ? (localStage ?? "intro") : server === "intro" && localStage && localStage !== "intro" ? localStage : server;
  const go = (s: OnboardingStage) => {
    if (store.get().token) void setOnboarding(s);
    else { localStage = s; force((v) => v + 1); }
  };
  useEffect(() => { if (stage === "tutorial" || stage === "done") onEnterGame(); }, [stage]);

  if (stage === "intro") return <Intro onDone={() => go("wallet")} />;
  if (stage === "wallet") return <Join onDone={() => go("catch")} onBack={onExit} />;
  if (stage === "catch") return <FirstCatch onDone={() => go("name")} onLater={onExit} />;
  if (stage === "name") return <NamePet onDone={() => go("world")} />;
  if (stage === "world") return <WorldIntro onDone={() => { void setOnboarding("tutorial", 0); onEnterGame(); }} />;
  return null;
}
/** Story position before an account exists (intro → join happen before sign-up). */
let localStage: OnboardingStage | null = null;

function Intro({ onDone }: { onDone: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [tossed, setTossed] = useState(false);
  const lines: Line[] = [
    { who: "", text: "Catchami used to be the brightest world you could imagine… glowing meadows, singing forests, a village that never slept." },
    { who: "", text: "But lately, the lights have been going out." },
    { who: "???", text: "…psst. You there. You can see me? Then you can still see the sparks." },
    { who: "The Keeper", text: "Forgive the dramatic entrance. I'm the Keeper — guardian of the CamiCubes.", cue: "reveal" },
    { who: "The Keeper", text: "Every real animal carries a tiny spark of personality. We call it a Cami. Those sparks are what keep our world bright." },
    { who: "The Keeper", text: "But no one has brought a new friend to Catchami in a long, long time. The sparks are fading… and the world is going grey." },
    { who: "The Keeper", text: "Toss a CamiCube at a real cat or dog, and its spark hops inside. It comes to life here as your sticker pet — and the world lights up a little more." },
    { who: "The Keeper", text: "This is the last cube that still glows. I've been saving it for someone special. Here — catch!", cue: "toss" },
    { who: "The Keeper", text: "Now, before you head out… tell me who you are, new Keeper." },
  ];
  return (
    <Scene night onSkip={onDone}>
      <div className="scene-stage">
        <Keeper reveal={revealed} cube={!tossed} pose={tossed ? "toss" : undefined} />
        {tossed && <img className="cube-toss" src={genUrl("cube-excited")} alt="" />}
      </div>
      <Dialogue lines={lines} onDone={onDone} onCue={(cue) => {
        if (cue === "reveal") { setRevealed(true); sfx.sparkle(); }
        if (cue === "toss") { setTossed(true); sfx.whoosh(); setTimeout(() => sfx.sparkle(), 500); }
      }} />
    </Scene>
  );
}

function Join({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const token = useStore((s) => s.token);
  const name = useStore((s) => s.displayName);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [wallets, setWallets] = useState(false);
  const [gift, setGift] = useState<string | null>(null);
  const [shop, setShop] = useState(false);

  const afterJoin = async () => {
    await setOnboarding("wallet");
    await refreshWallet().catch(() => {});
    setShop(true);
  };
  const guest = async () => {
    setBusy("guest"); setErr(null);
    try { if (!store.get().token) await startAsGuest(); await afterJoin(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const google = async () => {
    setBusy("google"); setErr(null);
    try {
      const r = await signInWithNearAuth();
      await adoptSession(r.token);
      if (!r.created && store.get().onboarding?.stage === "done") { window.location.assign("/game"); return; }
      await afterJoin();
    } catch (e) { const m = (e as Error).message; setErr(/popup|closed|cancel/i.test(m) ? "Sign-in was closed — tap Continue with Google to try again." : m); } finally { setBusy(null); }
  };
  const soon = (what: string) => setErr(`${what} sign-in is coming soon — use a guest, Google or NEAR account for now.`);
  const near = async (id: WalletId) => {
    setBusy(id); setErr(null);
    try {
      const r = await signInWithNear(id);
      await adoptSession(r.token);
      if (!r.created && store.get().onboarding?.stage === "done") { window.location.assign("/game"); return; }
      await afterJoin();
    } catch (e) { setErr((e as Error).message); void prepareNear().catch(() => {}); } finally { setBusy(null); }
  };

  if (shop && gift === null) return <BuyCoins onBought={(amount) => { setGift(amount); sfx.win(); }} />;
  if (gift !== null) {
    return (
      <Scene>
        {/* Reward reveal: rays, bursting coins, ribbon title, big amount — no panel. */}
        <div className="reward">
          <div className="reward-amount">{gift ? `+${formatTokens(BigInt(gift))}` : STARTER}<small>$CATCHAMI</small></div>
          <div className="reward-stage">
            <div className="reward-rays" aria-hidden />
            <div className="reward-coins" aria-hidden>{Array.from({ length: 12 }, (_, k) => <img key={k} src={genUrl("ui-coin")} alt="" style={{ "--a": `${k * 30}deg`, "--d": `${(k % 3) * 90}ms` } as React.CSSProperties} />)}</div>
            {/* CamiCube on a heap of coins (the generated gift box art is cropped at its edges). */}
            <div className="reward-gift">
              <div className="coin-heap" aria-hidden>{[[-62, 0], [-30, -4], [2, 2], [34, -3], [64, 1], [-46, -26], [-14, -30], [18, -27], [48, -24], [-30, -52], [2, -56], [32, -50]].map(([x, y = 0], k) => <img key={k} src={genUrl("ui-coin")} alt="" style={{ left: `calc(50% + ${x}px)`, bottom: `${8 - y}px` }} />)}</div>
              <img className="heap-cube" src={genUrl("cube-excited")} alt="" />
            </div>
            <Keeper size={120} cube={false} pose="wave" className="mini reward-keeper" />
          </div>
          <p className="reward-line">"Now you're ready, Keeper!" A CamiCube costs <b>{CUBE_COST}</b> — and the last glowing cube <b>always holds</b>.</p>
          <div className="reward-btn"><button className="game-btn start sm" onClick={onDone}><span className="gb-label">Let's catch!</span></button></div>
        </div>
      </Scene>
    );
  }
  return (
    <Scene onSkip={undefined}>
      <div className="scene-stage small"><Keeper size={170} pose="idle" /></div>
      <div className="join panel">
        <h2>Who's the new Keeper?</h2>
        {token && <p className="small muted" style={{ margin: 0, textAlign: "center" }}>Playing on this device as <b>{name}</b></p>}
        <button className="join-opt" disabled={!!busy} onClick={guest}>
          <img src={genUrl("cube-happy")} alt="" />
          <span><b>{busy === "guest" ? "Starting…" : token ? "Continue on this device" : "Play as guest"}</b><small>Start instantly. Progress is saved on this device.</small></span>
        </button>
        <button className="join-opt google" disabled={!!busy} onClick={google}>
          <span className="g-logo" aria-hidden>G</span>
          <span><b>{busy === "google" ? "Signing in…" : "Continue with Google"}</b><small>{nearAuthAvailable() ? "Powered by NEAR Auth — a real wallet with no app or seed phrase. Pets mint straight into it." : "NEAR Auth · waiting for NEAR to approve this website"}</small></span>
        </button>
        <button className={`join-opt near ${wallets ? "open" : ""}`} disabled={!!busy} onClick={() => { if (!wallets) void prepareNear().catch(() => {}); setWallets((v) => !v); }}>
          <span className="near-logo">N</span>
          <span><b>Connect a NEAR wallet</b><small>Your pets are minted straight into your wallet as NFTs.</small></span>
        </button>
        {wallets && (
          <div className="wallet-list">
            {WALLETS.map((w) => (
              <button key={w.id} className="btn paper" disabled={!!busy} onClick={() => void near(w.id)}>
                <b>{w.icon} {busy === w.id ? "Waiting for wallet…" : w.name}</b><small>{w.note}</small>
              </button>
            ))}
            <p className="small muted" style={{ margin: 0 }}>No testnet account? Create one free in <a href="https://wallet.meteorwallet.app" target="_blank" rel="noreferrer">Meteor Wallet</a> (switch it to Testnet). Catchami only asks your wallet to sign a message — never your seed phrase.</p>
          </div>
        )}
        <div className="join-soon">
          <button className="join-opt soon" onClick={() => soon("Solana")}><span className="chain-logo sol" aria-hidden>◎</span><span><b>Solana wallet</b><small>Phantom, Solflare…</small></span><em>Soon</em></button>
          <button className="join-opt soon" onClick={() => soon("EVM")}><span className="chain-logo evm" aria-hidden>⟠</span><span><b>EVM wallet</b><small>MetaMask, Rabby…</small></span><em>Soon</em></button>
        </div>
        {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
        <button className="link-btn" onClick={onBack}>‹ Back to title</button>
      </div>
    </Scene>
  );
}

/** First-time purchase of $CATCHAMI (simulated on test networks: no payment is taken). */
function BuyCoins({ onBought }: { onBought: (amount: string) => void }) {
  const near = useStore((s) => s.nearAccount);
  const packs = ECONOMY.catch.starterPacks;
  const [pick, setPick] = useState<string>(packs[1]!.id);
  const [phase, setPhase] = useState<"choose" | "paying">("choose");
  const [step, setStep] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const pack = packs.find((p) => p.id === pick)!;
  const buy = async () => {
    setPhase("paying"); setErr(null); setStep(0); sfx.pop();
    try {
      const res = api<{ amount: string; already: boolean }>("/api/onboarding/starter", { pack: pick });
      for (let k = 1; k <= 3; k++) { await new Promise((r) => setTimeout(r, 650)); setStep(k); sfx.tick(); }
      const r = await res;
      await refreshWallet().catch(() => {});
      onBought(r.amount);
    } catch (e) { setErr((e as Error).message); setPhase("choose"); }
  };
  const STEPS = ["Opening wallet…", "Paying " + pack.near + " NEAR on testnet…", "Swapping for $CATCHAMI…", "Done!"];
  return (
    <Scene>
      <div className="scene-stage small"><Keeper size={150} cube={false} pose="point" /></div>
      <div className="buy panel">
        <h2>Get your first $CATCHAMI</h2>
        <p className="center small" style={{ margin: 0 }}>"Every Keeper needs coins for CamiCubes and snacks. Pick a pouch!"</p>
        <div className="packs">
          {packs.map((p, i) => (
            <button key={p.id} className={`pack ${pick === p.id ? "on" : ""}`} disabled={phase === "paying"} onClick={() => setPick(p.id)}>
              {p.tag && <span className="pack-tag">{p.tag}</span>}
              <span className="pack-coins">{Array.from({ length: i + 1 }, (_, k) => <img key={k} src={genUrl("ui-coin")} alt="" />)}</span>
              <b>{p.name}</b>
              <span className="pack-amt">{formatTokens(tokens(p.whole))}</span>
              <span className="pack-price">{p.near} NEAR</span>
            </button>
          ))}
        </div>
        {phase === "paying" ? (
          <div className="pay-steps">{STEPS.map((t, k) => <span key={t} className={k < step ? "done" : k === step ? "now" : ""}><i>{k < step ? "✓" : k === step ? <span className="spinner sm" /> : ""}</i>{t}</span>)}</div>
        ) : (
          <button className="game-btn start sm" onClick={buy}><span className="gb-label">Buy · {pack.near} NEAR</span></button>
        )}
        <p className="small muted center" style={{ margin: 0 }}>{near ? `Paying from ${near}` : "Guest checkout"} · demo purchase on NEAR testnet</p>
        {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
      </div>
    </Scene>
  );
}

function FirstCatch({ onDone, onLater }: { onDone: () => void; onLater: () => void }) {
  const own = useStore((s) => s.own);
  const [camera, setCamera] = useState(false);
  const startCount = useRef<number | null>(null);
  const desktop = useMemo(isDesktop, []);
  // Start downloading the animal finder now, so the camera is ready faster.
  useEffect(() => { if (!desktop) void import("./Catch.tsx").then((m) => m.loadModel()).catch(() => {}); }, []);
  // While waiting on the phone hand-off, a pet caught there shows up here over
  // the live connection (the server's story stage is a backup). Not while this
  // device's own camera is open — that screen shows the catch reveal first.
  useEffect(() => {
    if (camera) return;
    if (startCount.current === null) startCount.current = own.length;
    if (own.length > startCount.current) onDone();
  }, [own.length, camera]);
  useEffect(() => {
    if (camera) return;
    const t = setInterval(() => { void refreshWallet().then(() => { const st = store.get().onboarding?.stage; if (st && st !== "catch") onDone(); }).catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, [camera]);

  if (camera) {
    return (
      <Suspense fallback={<div className="catch" />}>
        <CatchScreen first onClose={() => { startCount.current = store.get().own.length; setCamera(false); }} onCaught={() => onDone()} />
      </Suspense>
    );
  }
  return (
    <Scene>
      <div className="mission">
        <MissionDemo />
        {desktop ? <PhoneHandoff /> : (
          <div className="mission-go"><button className="game-btn start sm" onClick={() => setCamera(true)}><span className="gb-label">Let's go!</span></button></div>
        )}
        <button className="link-btn mission-later" onClick={onLater}>No animal around? Come back later ›</button>
      </div>
    </Scene>
  );
}

const MISSION_STEPS = [
  { title: "Find a buddy", text: "Spot a real cat or dog nearby — yours, a friend's, the neighbour's!" },
  { title: "Aim your camera", text: "Point at it until the yellow box turns green and locks on." },
  { title: "Flick the cube!", text: "Swipe the CamiCube at it. The last glowing cube always holds!" },
];

/** Looping mini-demo of the three catch steps, Keeper as the coach. */
export function MissionDemo({ title = "Bring back the first spark!" }: { title?: string } = {}) {
  const [step, setStep] = useState(0);
  const [hold, setHold] = useState(false);
  useEffect(() => {
    if (hold) return;
    const t = setTimeout(() => setStep((v) => (v + 1) % 3), 2600);
    return () => clearTimeout(t);
  }, [step, hold]);
  const m = MISSION_STEPS[step]!;
  const pills = (
    <div className="mdemo-pills">
      {MISSION_STEPS.map((x, k) => (
        <button key={x.title} className={k === step ? "on" : k < step ? "done" : ""} onClick={() => { setStep(k); setHold(true); }} aria-label={x.title}>{k < step ? "✓" : k + 1}</button>
      ))}
    </div>
  );
  return (
    <div className="mdemo">
      <div className="mission-head">
        <div className="mission-row">{pills}</div>
        <h2>{title}</h2>
      </div>
      <div className="mdemo-stage">
      <div className={`mdemo-window s${step}`} key={step}>
        <img className="mdemo-pet" src={genUrl(["demo-cat-look", "demo-cat-face", "demo-cat-wow"][step]!)} alt="" draggable={false} />
        {step === 0 && <img className="mdemo-glass" src={genUrl("demo-magnifier")} alt="" draggable={false} />}
        {step >= 1 && <span className="mdemo-box" aria-hidden />}
        {step === 2 && <img className="mdemo-cube" src={genUrl("cube-fly")} alt="" />}
        {step === 2 && <span className="mdemo-spark" aria-hidden>{Array.from({ length: 8 }, (_, k) => <i key={k} style={{ "--a": `${k * 45}deg` } as React.CSSProperties} />)}</span>}
        <span className="mdemo-phone" aria-hidden />
      </div>
      <div className="mdemo-coach">
        <Keeper size={92} cube={false} pose={step === 2 ? "toss" : step === 1 ? "point" : "wave"} className="mini" />
        <div className={`mdemo-bubble t${step}`} key={`t${step}`}>
          <span className="mdemo-step">Step {step + 1}</span>
          <b>{m.title}</b>
          <span>{m.text}</span>
          <i className="mdemo-star a" aria-hidden>★</i><i className="mdemo-star b" aria-hidden>✦</i>
        </div>
      </div>
      </div>
    </div>
  );
}

/** Laptop: show a QR the phone scans to continue the same account on its camera. */
export function PhoneHandoff() {
  const [qr, setQr] = useState<{ url: string; img: string; expiresAt: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const make = async () => {
    setErr(null);
    try {
      const h = await api<{ code: string; expiresAt: number; lan: string[] }>("/api/handoff", {});
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
      const origin = local && h.lan[0] ? `${location.protocol}//${h.lan[0]}${location.port ? `:${location.port}` : ""}` : location.origin;
      const url = `${origin}/catch?h=${encodeURIComponent(h.code)}`;
      const q = qrcode(0, "M");
      q.addData(url); q.make();
      setQr({ url, img: q.createDataURL(6, 2), expiresAt: h.expiresAt });
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void make(); }, []);
  useEffect(() => {
    if (!qr) return;
    const t = setTimeout(() => void make(), Math.max(5_000, qr.expiresAt - Date.now() - 5_000));
    return () => clearTimeout(t);
  }, [qr]);
  return (
    <div className="handoff">
      <div className="handoff-qr">{qr ? <img src={qr.img} alt="QR code to continue on your phone" /> : <span className="spinner" />}</div>
      <div className="handoff-text">
        <img className="handoff-art" src={genUrl("handoff")} alt="" />
        <b>Scan with your phone</b>
        <p className="small" style={{ margin: 0 }}>Catching happens on your phone. Scan this, catch the animal, and this screen continues by itself.</p>
        <p className="waiting small"><span className="dot" /> Waiting for your catch…</p>
        {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
      </div>
    </div>
  );
}

function NamePet({ onDone }: { onDone: () => void }) {
  const own = useStore((s) => s.own);
  const pet = useMemo(() => [...own].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null, [own]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (pet && !name) setName(pet.name); }, [pet?.id]);
  const save = async () => {
    if (!pet) return;
    setBusy(true); setErr(null);
    try { await api(`/api/pets/${pet.id}/name`, { name }); sfx.sparkle(); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const roll = () => setName(SUGGEST[Math.floor(Math.random() * SUGGEST.length)]!);
  return (
    <Scene>
      <div className="name-scene">
        {pet ? <CollectorCard flipIn width={Math.min(250, window.innerWidth - 80)} card={{ id: pet.id, name: name || pet.name, species: pet.species, rarity: pet.rarity, sticker: pet.sticker, look: pet.look, stats: pet.baseStats, traits: pet.traits }} /> : <span className="spinner" />}
        <div className="panel name-box">
          <Keeper size={70} className="mini" cube={false} pose="wave" />
          <p style={{ margin: 0 }}><b>The Keeper:</b> Look at that glow! The first spark in ages. What will you call your new friend?</p>
          <div className="row">
            <input className="input grow" value={name} maxLength={16} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(); }} aria-label="Pet name" />
            <button className="btn paper" onClick={roll} title="Suggest a name">🎲</button>
          </div>
          {err && <p className="err small" style={{ margin: 0 }}>{err}</p>}
          <button className="game-btn start sm" disabled={busy || !name.trim() || !pet} onClick={save}><span className="gb-label">That's the one!</span></button>
        </div>
      </div>
    </Scene>
  );
}
const SUGGEST = ["Biscuit", "Mochi", "Pumpkin", "Noodle", "Pepper", "Waffles", "Tofu", "Bean", "Clover", "Pickles", "Maple", "Sprout", "Nugget", "Juniper", "Toast"];

function WorldIntro({ onDone }: { onDone: () => void }) {
  const own = useStore((s) => s.own);
  const pet = [...own].sort((a, b) => b.createdAt - a.createdAt)[0];
  const n = pet?.name ?? "your pet";
  const lines: Line[] = [
    { who: "The Keeper", text: `Do you feel that? ${n}'s spark just lit up the whole sky. Catchami hasn't been this bright in years!` },
    { who: "The Keeper", text: "Paw Village is waking up — lanterns flickering on, merchants dusting off their carts. It's a safe place: no battles, just friends, shops and HQ." },
    { who: "The Keeper", text: "West lies the Whispering Forest — wood, fish and herbs. East is Mining Valley, full of stone. Both still need more light." },
    { who: "The Keeper", text: `Sparks shine brightest when pets are happy. Gather, trade with travelling merchants, and keep ${n} well fed.` },
    { who: "The Keeper", text: "Out in the wild, other pets may challenge yours to Bubble Roulette — a splashy game of nerves. Just bragging rights, no hard feelings." },
    { who: "The Keeper", text: "And the roads north and south? Still too dark to travel. Bring enough friends home, and one day they'll light up too." },
    { who: "The Keeper", text: "But first — follow me to my glade for a little practice. Then we'll go wake this world up, together!" },
  ];
  return (
    <Scene onSkip={onDone}>
      <div className="scene-stage">
        {/* The Keeper proudly holds up your new collector card. */}
        <div className="keeper-holding">
          <Keeper size={230} cube={false} />
          {pet && <div className="held-card"><CollectorCard flipIn width={96} card={cardFromPet(pet)} /></div>}
        </div>
      </div>
      <Dialogue lines={lines} onDone={onDone} />
    </Scene>
  );
}

// ------------------------------------------------------------ returning players

export function WelcomeBack({ onContinue, onNew, onClose }: { onContinue: () => void; onNew: () => void; onClose: () => void }) {
  const name = useStore((s) => s.displayName);
  const near = useStore((s) => s.nearAccount);
  const onboarding = useStore((s) => s.onboarding);
  const own = useStore((s) => s.own);
  const [confirm, setConfirm] = useState(false);
  const done = onboarding?.stage === "done" || onboarding?.stage === "tutorial";
  return (
    <div className="howto-backdrop" onClick={onClose}>
      <div className="welcome-back panel" onClick={(e) => e.stopPropagation()}>
        <Keeper size={110} cube={false} className="mini" pose="wave" />
        <h2>Welcome back!</h2>
        <p className="center" style={{ margin: 0 }}>{near ? <>Wallet <b>{near}</b></> : <>Guest <b>{name}</b> on this device</>}{own.length ? ` · ${own.length} pet${own.length > 1 ? "s" : ""}` : ""}</p>
        {own.length > 0 && <div className="wb-pets">{own.slice(0, 5).map((p) => <img key={p.id} src={p.sticker ?? genUrl("cube-happy")} alt={p.name} title={p.name} />)}</div>}
        <button className="game-btn start sm" onClick={onContinue}><span className="gb-label">Continue</span></button>
        {!confirm
          ? <button className="game-btn help sm" onClick={() => setConfirm(true)}><span className="gb-label">New game</span></button>
          : (
            <div className="notice small col" style={{ gap: 8 }}>
              <span>{near ? "You'll sign out of this wallet on this device. Your pets stay safe with the wallet — connect it again any time." : "This starts a fresh guest player on this device. The current guest's pets can't be recovered without a linked wallet."}</span>
              <div className="row"><button className="btn paper grow" onClick={() => setConfirm(false)}>Keep playing</button><button className="btn coral grow" onClick={() => { forgetDevice(); onNew(); }}>Start new game</button></div>
            </div>
          )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ phone hand-off page (/catch?h=…)

export function PhoneCatch({ onGame }: { onGame: () => void }) {
  const [state, setState] = useState<"redeem" | "ready" | "done" | "error">("redeem");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(location.search).get("h");
    if (!code) { setState(store.get().token ? "ready" : "error"); setErr("Open this page by scanning the QR code on your computer."); return; }
    api<{ token: string }>("/api/handoff/redeem", { code })
      .then(async (r) => { await adoptSession(r.token); history.replaceState(null, "", "/catch"); setState("ready"); })
      .catch((e) => { setErr((e as Error).message); setState(store.get().token ? "ready" : "error"); });
  }, []);
  if (state === "redeem") return <Scene><div className="center-msg panel"><span className="spinner" /> Connecting to your game…</div></Scene>;
  if (state === "error") return <Scene><div className="center-msg panel"><h3>Hmm</h3><p>{err}</p></div></Scene>;
  if (state === "done") {
    return (
      <Scene>
        <div className="center-msg panel">
          <img src={genUrl("cube-excited")} alt="" style={{ width: 90 }} />
          <h2>Caught!</h2>
          <p>The first spark is home! Head back to your computer — your new friend is waiting there to be named.</p>
          <button className="btn paper" onClick={onGame}>Or keep playing on this phone</button>
        </div>
      </Scene>
    );
  }
  const first = (store.get().onboarding?.stage ?? "catch") === "catch";
  return (
    <Suspense fallback={<div className="catch" />}>
      <CatchScreen first={first} onClose={() => setState("done")} onCaught={() => { if (first) void setOnboarding("name"); setState("done"); }} />
    </Suspense>
  );
}

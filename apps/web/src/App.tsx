import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import { store, useStore } from "./net/store.ts";
import { boot, startAsGuest } from "./net/api.ts";
import { ActionBar, BottomNav, Joystick, PetCard, Toasts, TopBar } from "./ui/Hud.tsx";
import { Sheets } from "./ui/Sheets.tsx";
import { PetsScreen } from "./ui/Pets.tsx";
import { FairnessScreen, MarketScreen, RanksScreen, WalletScreen } from "./ui/Screens.tsx";
import { AreaBanner, MapScreen, QuickButtons } from "./ui/WorldHud.tsx";
import { EconomyGuide } from "./ui/EconomyGuide.tsx";
import { MinigameLayer } from "./ui/Minigame.tsx";
import { BubbleInvite, BubbleScreen } from "./ui/Bubble.tsx";

const CatchScreen = lazy(() => import("./ui/Catch.tsx").then((m) => ({ default: m.CatchScreen })));
const AdminPage = lazy(() => import("./ui/Admin.tsx").then((m) => ({ default: m.AdminPage })));

/** Routes: "/" is always the title scene; "/game" is the game; "/admin" is operations. */
function usePath(): [string, (p: string, replace?: boolean) => void] {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const go = (p: string, replace = false) => {
    if (p !== location.pathname) (replace ? history.replaceState : history.pushState).call(history, null, "", p);
    setPath(p);
  };
  return [path, go];
}

export function App() {
  const token = useStore((s) => s.token);
  const [booted, setBooted] = useState(false);
  const [path, go] = usePath();
  useEffect(() => { void boot().finally(() => setBooted(true)); }, []);
  // No account yet: the game route sends you back to the title scene.
  useEffect(() => { if (booted && !token && path.startsWith("/game")) go("/", true); }, [booted, token, path]);
  if (path.startsWith("/admin")) return <Suspense fallback={null}><AdminPage /></Suspense>;
  if (!booted) return <div className="title-screen"><img className="title-logo" src="/assets/gen/logo.png" alt="Catchami" /></div>;
  if (path.startsWith("/game") && token) return <Shell />;
  return <Welcome onStart={() => go("/game")} />;
}

function Welcome({ onStart }: { onStart: () => void }) {
  const token = useStore((s) => s.token);
  const name = useStore((s) => s.displayName);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    if (token) return onStart();
    setBusy(true); setErr(null);
    try { await startAsGuest(); onStart(); } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  const [help, setHelp] = useState(false);
  const [econ, setEcon] = useState(false);
  return (
    <div className="title-screen">
      <TitleLife />
      <img className="title-logo" src="/assets/gen/logo.png" alt="Catchami" />
      <div className="title-menu">
        <button className="game-btn start" disabled={busy} onClick={start}>
          <img className="gb-icon" src="/assets/gen/cube-happy.png" alt="" />
          <span className="gb-label">{busy ? "Loading…" : "Start game"}</span>
          <span className="gb-shine" />
        </button>
        <button className="game-btn help" onClick={() => setHelp(true)}>
          <span className="gb-badge">?</span>
          <span className="gb-label">How to play</span>
        </button>
        <button className="game-btn coins" onClick={() => setEcon(true)}>
          <img className="gb-coin" src="/assets/gen/ui-coin.png" alt="" />
          <span className="gb-label">How coins work</span>
        </button>
        {err && <span className="title-who err">{err}</span>}
      </div>
      <p className="title-legal">Paid features use the $CATCHAMI token on NEAR. Token prices can fall; nothing in Catchami promises earnings.</p>
      {help && <HowToPlay onClose={() => setHelp(false)} />}
      {econ && <EconomyGuide onClose={() => setEcon(false)} />}
    </div>
  );
}

const HOW_TO: Array<[string, string, string]> = [
  ["cube-excited", "Catch a real animal", "Point your camera at a real cat or dog, then throw the CamiCube. A catch becomes your sticker pet."],
  ["icon-herbs", "Gather", "Walk to a resource spot and tap Gather. Time your tap (or hold & release for herbs) to get more."],
  ["merchant-finn", "Trade", "Sell what you gather to travelling merchants. Buy meals and medicine to keep your pet going."],
  ["ui-map", "Explore", "Four big areas: Cozy Meadow, Fantasy Town, Enchanted Forest and Mining Valley."],
  ["cube-wobble", "Bubble Roulette", "Challenge another player's pet. Splash yourself or your opponent — last pet with HP wins."],
  ["ui-backpack", "Autopilot", "Set a strategy and your pet keeps working while you're away."],
];

function HowToPlay({ onClose }: { onClose: () => void }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="howto-backdrop" onClick={onClose}>
      <div className="howto panel" onClick={(e) => e.stopPropagation()}>
        <h2>How to play</h2>
        <div className="howto-list">
          {HOW_TO.map(([img, title, text], i) => (
            <div key={title} className="howto-item">
              <span className="howto-num">{i + 1}</span>
              <img src={`/assets/gen/${img}.png`} alt="" />
              <div><b>{title}</b><p>{text}</p></div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0, textAlign: "center" }}>Controls: joystick or WASD to move · tap/click to walk · C catch · M map</p>
        <button className="game-btn start" style={{ minHeight: 66, fontSize: 26 }} onClick={onClose}><span className="gb-label">Got it!</span></button>
      </div>
    </div>
  );
}

const KEY_HELP = "WASD/arrows move · click to walk · wheel or +/− zoom · C catch · M map · B backpack · Esc close";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const s = store.get();
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (s.sheet) store.set({ sheet: null });
        else if (s.screen !== "world") store.set({ screen: "world", petScreen: null });
      } else if (s.screen === "world" || s.screen === "map") {
        if (k === "c") store.set({ screen: "catch", sheet: null });
        else if (k === "m") store.set({ screen: s.screen === "map" ? "world" : "map", sheet: null });
        else if (k === "b") store.set({ screen: "pets", petScreen: s.controlled, sheet: null });
        else if (k === "p") store.set({ screen: "pets", petScreen: null, sheet: null });
        else if (k === "=" || k === "+") window.dispatchEvent(new CustomEvent("catchami:zoom", { detail: { factor: 1.15 } }));
        else if (k === "-" || k === "_") window.dispatchEvent(new CustomEvent("catchami:zoom", { detail: { factor: 0.87 } }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

function KeyHint() {
  const fine = typeof window !== "undefined" && window.matchMedia("(pointer: fine)").matches;
  const [show, setShow] = useState(() => { try { return localStorage.getItem("catchami.keyhint") !== "off"; } catch { return true; } });
  if (!fine || !show) return null;
  return (
    <button className="keyhint" onClick={() => { setShow(false); try { localStorage.setItem("catchami.keyhint", "off"); } catch {} }} title="Hide">
      {KEY_HELP} <b>×</b>
    </button>
  );
}

function Shell() {
  useShortcuts();
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const screen = useStore((s) => s.screen);
  const bubble = useStore((s) => s.bubble);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([import("./game/GameScene.ts"), document.fonts.load("600 14px Fredoka")]).then(async ([m]) => {
      // WebGL must not boot on a 0×0 canvas (it leaves the renderer half-initialised): wait for layout.
      for (let i = 0; i < 60 && host.current && (!host.current.clientWidth || !host.current.clientHeight); i++) await new Promise((r) => setTimeout(r, 50));
      if (cancelled || !host.current) return;
      game.current = m.createGame(host.current);
    });
    // Keep the canvas matched to its container (rotation, browser chrome, split view).
    const ro = new ResizeObserver(() => { const el = host.current; if (el && game.current) game.current.scale.resize(el.clientWidth, el.clientHeight); });
    if (host.current) ro.observe(host.current);
    return () => { cancelled = true; ro.disconnect(); game.current?.destroy(true); game.current = null; };
  }, []);
  return (
    <div className="shell">
      <div className="canvas-host" ref={host} />
      <div className="hud">
        {(screen === "world" || screen === "map") && (<><TopBar /><PetCard /><AreaBanner /><QuickButtons /><Joystick /><ActionBar /><Sheets /></>)}
        {screen === "map" && <MapScreen />}
        {screen === "world" && <MinigameLayer />}
        <BubbleInvite />
        {bubble && <BubbleScreen />}
        {screen === "world" && <KeyHint />}
        {screen === "pets" && <PetsScreen />}
        {screen === "market" && <MarketScreen />}
        {screen === "ranks" && <RanksScreen />}
        {screen === "wallet" && <WalletScreen />}
        {screen === "fairness" && <FairnessScreen />}
        {screen === "catch" && <Suspense fallback={<div className="catch" />}><CatchScreen /></Suspense>}
        {screen !== "catch" && <BottomNav />}
        <Toasts />
      </div>
    </div>
  );
}

export { store };

/** A few gentle wanderers on the title background so the world feels alive. Decorative only. */
function TitleLife() {
  return (
    <div className="title-life" aria-hidden>
      <span className="cloud c1" /><span className="cloud c2" /><span className="cloud c3" />
      <div className="walker w1"><img src="/assets/gen/merchant-finn.png" alt="" /></div>
      <div className="walker w2 flip"><img src="/assets/gen/merchant-marigold.png" alt="" /></div>
      <div className="walker w3"><img src="/assets/gen/cube-happy.png" alt="" /></div>
      <div className="walker w4 flip"><img src="/assets/gen/merchant-tom.png" alt="" /></div>
      <img className="leaper" src="/assets/gen/icon-fish.png" alt="" />
      <span className="flutter f1" /><span className="flutter f2" />
    </div>
  );
}

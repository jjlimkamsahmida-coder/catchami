import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import { store, useStore } from "./net/store.ts";
import { boot, startAsGuest } from "./net/api.ts";
import { ActionBar, BottomNav, Joystick, PetCard, Toasts, TopBar } from "./ui/Hud.tsx";
import { Sheets } from "./ui/Sheets.tsx";
import { PetsScreen } from "./ui/Pets.tsx";
import { FairnessScreen, MarketScreen, RanksScreen, WalletScreen } from "./ui/Screens.tsx";
import { AreaBanner, MapScreen, QuickButtons } from "./ui/WorldHud.tsx";

const CatchScreen = lazy(() => import("./ui/Catch.tsx").then((m) => ({ default: m.CatchScreen })));
const AdminPage = lazy(() => import("./ui/Admin.tsx").then((m) => ({ default: m.AdminPage })));

export function App() {
  const token = useStore((s) => s.token);
  const [booted, setBooted] = useState(false);
  useEffect(() => { void boot().finally(() => setBooted(true)); }, []);
  if (location.pathname.startsWith("/admin")) return <Suspense fallback={null}><AdminPage /></Suspense>;
  if (!booted) return <div className="title-screen"><img className="title-logo" src="/assets/gen/logo.png" alt="Catchami" /></div>;
  if (!token) return <Welcome />;
  return <Shell />;
}

function Welcome() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="title-screen">
      <img className="title-logo" src="/assets/gen/logo.png" alt="Catchami" />
      <div className="col" style={{ alignItems: "center", width: "100%" }}>
        <div className="panel title-box col" style={{ gap: 12 }}>
          <p className="title-tag">Catch the Real. Play the World.</p>
          <p style={{ margin: 0, fontSize: 17 }}>Find real cats and dogs with your camera. Each one you catch becomes a sticker pet that gathers, trades and scuffles in a shared world — even while you're away.</p>
          <button className="btn leaf block" style={{ fontSize: 20, minHeight: 56 }} disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await startAsGuest(); } catch (e) { setErr((e as Error).message); setBusy(false); } }}>
            {busy ? "Setting up…" : "Start playing"}
          </button>
          {err && <div className="notice warn small">{err}</div>}
          <p className="small muted" style={{ margin: 0 }}>
            Starts a device account with no email or password. Paid features use the $CATCHAMI token on NEAR; token prices can fall, nothing in Catchami promises earnings, and some features are unavailable in some regions.
          </p>
        </div>
      </div>
    </div>
  );
}

function Shell() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);
  const screen = useStore((s) => s.screen);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([import("./game/GameScene.ts"), document.fonts.load("600 14px Fredoka")]).then(([m]) => {
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

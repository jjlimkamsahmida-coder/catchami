import { useEffect, useRef, useState } from "react";
import { AREAS, type WorldDef } from "@catchami/shared";
import { entities, store, useStore } from "../net/store.ts";
import { send } from "../net/api.ts";
import { miniMap } from "../game/world-art.ts";
import { genUrl } from "../game/assets.ts";

const TILE = 32;
let worldDef: WorldDef | null = null;
let mapCanvas: HTMLCanvasElement | null = null;
const listeners = new Set<() => void>();
window.addEventListener("catchami:world", (e) => {
  worldDef = (e as CustomEvent<WorldDef>).detail;
  mapCanvas = miniMap(worldDef);
  for (const l of listeners) l();
});

function useWorld() {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return worldDef;
}

function myPos(): [number, number] | null {
  const s = store.get();
  const e = s.controlled ? entities.get(s.controlled) : null;
  const last = e?.samples.at(-1);
  if (last) return [last[1], last[2]];
  const own = s.own.find((p) => p.id === s.controlled);
  return own ? [own.x, own.y] : s.hq ? [s.hq.tx * TILE, s.hq.ty * TILE] : null;
}

/** "📍 Cozy Meadow" banner when the controlled pet enters a new area, plus a persistent chip. */
export function AreaBanner() {
  const [area, setArea] = useState<{ id: string; name: string; key: number } | null>(null);
  useEffect(() => {
    const h = (e: Event) => { const d = (e as CustomEvent<{ id: string; name: string }>).detail; setArea({ id: d.id, name: d.name, key: Date.now() }); };
    window.addEventListener("catchami:area", h);
    return () => window.removeEventListener("catchami:area", h);
  }, []);
  if (!area) return null;
  return (
    <div key={area.key} className="area-card">
      <img src={`/assets/gen/banner-${area.id}.webp`} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
      <span><img src={genUrl("ui-pin")} alt="" />{area.name}{area.id === "village" ? " · safe zone" : ""}</span>
    </div>
  );
}

export function MiniMap() {
  const world = useWorld();
  const ref = useRef<HTMLCanvasElement>(null);
  const [areaName, setAreaName] = useState("");
  useEffect(() => {
    const h = (e: Event) => setAreaName((e as CustomEvent<{ name: string }>).detail.name);
    window.addEventListener("catchami:area", h);
    return () => window.removeEventListener("catchami:area", h);
  }, []);
  useEffect(() => {
    if (!world || !mapCanvas) return;
    const SCALE = 2.4, SIZE = 92;
    const draw = () => {
      const c = ref.current;
      const pos = myPos();
      if (!c || !pos) return;
      const g = c.getContext("2d")!;
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, SIZE, SIZE);
      const tx = pos[0] / TILE, ty = pos[1] / TILE;
      g.drawImage(mapCanvas!, SIZE / 2 - tx * SCALE, SIZE / 2 - ty * SCALE, world.w * SCALE, world.h * SCALE);
      // Merchants as yellow dots.
      for (const m of store.get().merchants) {
        g.fillStyle = "#ffd166"; g.strokeStyle = "#2b1d3a"; g.lineWidth = 1.5;
        g.beginPath(); g.arc(SIZE / 2 + (m.x / TILE - tx) * SCALE, SIZE / 2 + (m.y / TILE - ty) * SCALE, 3.5, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    };
    draw();
    const id = setInterval(draw, 300);
    return () => clearInterval(id);
  }, [world]);
  if (!world) return null;
  return (
    <div className="col" style={{ alignItems: "center", gap: 4 }}>
      <button className="minimap" onClick={() => store.set({ sheet: null, screen: "map" })} aria-label="Open map">
        <canvas ref={ref} width={92} height={92} />
        <span className="me" />
      </button>
      {areaName && <span className="area-chip"><img src={genUrl("ui-pin")} alt="" />{areaName}</span>}
    </div>
  );
}

export function QuickButtons() {
  return (
    <div className="quickbtns">
      <button className="quickbtn" onClick={() => store.set({ screen: "pets", petScreen: store.get().controlled })} aria-label="Backpack"><img src={genUrl("ui-backpack")} alt="" /></button>
      <button className="quickbtn" onClick={() => store.set({ screen: "map" })} aria-label="Map"><img src={genUrl("ui-map")} alt="" /></button>
    </div>
  );
}

const AREA_CENTERS: Record<string, [number, number]> = { forest: [36, 8], village: [96, 8], mines: [156, 8] };

export function MapScreen() {
  const world = useWorld();
  const ref = useRef<HTMLCanvasElement>(null);
  const own = useStore((s) => s.own);
  const merchants = useStore((s) => s.merchants);
  useEffect(() => {
    const c = ref.current;
    if (!c || !world || !mapCanvas) return;
    const g = c.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.drawImage(mapCanvas, 0, 0, c.width, c.height);
  }, [world]);
  if (!world) return null;
  const pos = myPos();
  const pct = (x: number, y: number) => ({ left: `${(x / (world.w * TILE)) * 100}%`, top: `${(y / (world.h * TILE)) * 100}%` });
  const close = () => store.set({ screen: "world" });
  return (
    <div className="mapscreen" onClick={close}>
      <div className="col" style={{ alignItems: "center", width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div className="mapwrap">
          <canvas ref={ref} width={world.w * 6} height={world.h * 6}
            onClick={(e) => {
              const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width) * world.w * TILE, y = ((e.clientY - r.top) / r.height) * world.h * TILE;
              send({ t: "goto", x, y });
              window.dispatchEvent(new CustomEvent("catchami:focus", { detail: { x, y } }));
              close();
            }} />
          {AREAS.map((a) => <span key={a.id} className="maplabel" style={pct(AREA_CENTERS[a.id]![0] * TILE, AREA_CENTERS[a.id]![1] * TILE)}>{a.name}</span>)}
          {merchants.map((m) => <span key={m.id} className="mapdot" style={{ ...pct(m.x, m.y), background: "#ffd166" }} title={m.name} />)}
          {own.filter((p) => p.id !== store.get().controlled).map((p) => <span key={p.id} className="mapdot" style={{ ...pct(p.x, p.y), background: "#7ccd5a" }} title={p.name} />)}
          {pos && <span className="mapdot" style={{ ...pct(pos[0], pos[1]), background: "#ff7a59", width: 16, height: 16, margin: -8 }} />}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span className="area-chip">Tap anywhere to walk there · <span style={{ color: "#ffd166" }}>●</span> merchants · <span style={{ color: "#7ccd5a" }}>●</span> your pets</span>
          <button className="btn sm paper" onClick={close}>Close</button>
        </div>
      </div>
    </div>
  );
}

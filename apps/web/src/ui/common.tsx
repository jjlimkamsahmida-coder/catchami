import { useEffect, useState, type ReactNode } from "react";
import { formatTokens, RARITY_LABEL, type Rarity, type Resource, type PetLook, type Species } from "@catchami/shared";
import * as art from "../game/art.ts";

const urlCache = new Map<string, string>();
const cached = (key: string, make: () => HTMLCanvasElement) => {
  let u = urlCache.get(key);
  if (!u) { u = make().toDataURL(); urlCache.set(key, u); }
  return u;
};

export const fmt = (wire: string | bigint | null | undefined) => {
  if (wire === null || wire === undefined || wire === "") return "—";
  return formatTokens(typeof wire === "bigint" ? wire : BigInt(wire));
};

export function ResIcon({ r, size = 18 }: { r: Resource; size?: number }) {
  return <img src={cached(`icon-${r}`, () => art.resourceIcon(r, 56))} width={size} height={size} alt={r} style={{ verticalAlign: "middle" }} />;
}

export function PetArt({ sticker, species, look, size }: { sticker: string | null; species: Species; look: PetLook; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = sticker && !failed ? sticker : cached(`pa:${species}:${look.hue}:${look.pattern}`, () => art.placeholderAnimal(species, look.hue, look.pattern));
  return <img src={src} onError={() => setFailed(true)} alt="" width={size} height={size} style={size ? undefined : { width: "100%", height: "100%", objectFit: "contain" }} />;
}

export function RarityTag({ r }: { r: Rarity }) {
  return <span className={`tag rarity ${r}`}>{RARITY_LABEL[r]}</span>;
}

export function Coin({ children }: { children?: ReactNode }) {
  return <span className="row" style={{ gap: 4 }}><span className="coin-dot" aria-hidden style={{ width: 14, height: 14, borderRadius: 99, background: "var(--sun)", border: "2px solid var(--ink)", display: "inline-block" }} />{children}</span>;
}

export function Icon({ name }: { name: "map" | "paw" | "shop" | "trophy" | "wallet" | "camera" | "close" | "back" | "shield" }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2.4, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "map": return <svg viewBox="0 0 24 24"><path {...p} d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" /></svg>;
    case "paw": return <svg viewBox="0 0 24 24"><circle {...p} cx="6.5" cy="10" r="2" /><circle {...p} cx="10" cy="5.5" r="2" /><circle {...p} cx="14.5" cy="5.5" r="2" /><circle {...p} cx="18" cy="10" r="2" /><path {...p} d="M8 17c0-3 2-5.5 4-5.5s4 2.5 4 5.5c0 2-1.8 3-4 3s-4-1-4-3Z" /></svg>;
    case "shop": return <svg viewBox="0 0 24 24"><path {...p} d="M4 9h16l-1.5-5h-13L4 9Zm0 0v11h16V9M9 20v-6h6v6" /></svg>;
    case "trophy": return <svg viewBox="0 0 24 24"><path {...p} d="M8 4h8v5a4 4 0 0 1-8 0V4Zm0 2H4a3 3 0 0 0 4 4m8-4h4a3 3 0 0 1-4 4m-4 3v4m-4 3h8" /></svg>;
    case "wallet": return <svg viewBox="0 0 24 24"><path {...p} d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1V7Zm0 0 11-3v3m1 7h.01" /></svg>;
    case "camera": return <svg viewBox="0 0 24 24"><path {...p} d="M4 8h3l2-3h6l2 3h3v11H4V8Z" /><circle {...p} cx="12" cy="13" r="3.5" /></svg>;
    case "close": return <svg viewBox="0 0 24 24" width="22" height="22"><path {...p} d="M6 6l12 12M18 6 6 18" /></svg>;
    case "back": return <svg viewBox="0 0 24 24" width="22" height="22"><path {...p} d="M15 5l-7 7 7 7" /></svg>;
    case "shield": return <svg viewBox="0 0 24 24" width="18" height="18"><path {...p} d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /></svg>;
  }
}

export function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet panel" role="dialog">
        <div className="grab" />
        {children}
      </div>
    </>
  );
}

export function ScreenHead({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="screen-head">
      {onBack && <button className="btn paper sm" onClick={onBack} aria-label="Back"><Icon name="back" /></button>}
      <h2 className="grow">{title}</h2>
      {right}
    </div>
  );
}

export function pct(ppm: number) {
  const v = ppm / 10_000;
  return v >= 1 ? `${v.toFixed(v % 1 ? 1 : 0)}%` : `${v.toFixed(v >= 0.1 ? 2 : 3)}%`;
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn().then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { data, error, loading, reload: () => setN((x) => x + 1) };
}

/** Tiny external store (no dependency) + React binding. */
import { useSyncExternalStore } from "react";
import type { MarketTicker, MerchantDetail, MerchantPublic, OwnPet, PetAnim, PublicPet } from "@catchami/shared";

export interface PetEntity {
  id: string;
  meta: PublicPet | null;
  // interpolation buffer: [serverTime(ms), x, y]
  samples: Array<[number, number, number]>;
  anim: PetAnim;
  facing: 1 | -1;
  lastSeen: number;
}

export interface Toast { id: number; kind: "info" | "good" | "bad"; text: string }

export interface State {
  token: string | null;
  userId: string | null;
  displayName: string;
  network: string;
  connected: boolean;
  map: { w: number; h: number; tiles: string } | null;
  nodesDef: Array<{ id: string; resource: "fish" | "herbs" | "wood" | "minerals"; tx: number; ty: number }>;
  pois: Array<{ id: string; label: string; tx: number; ty: number }>;
  hq: { tx: number; ty: number } | null;
  nodes: Record<string, number>;
  merchants: MerchantPublic[];
  merchantDetail: Record<string, { detail: MerchantDetail; at: number }>;
  own: OwnPet[];
  controlled: string | null;
  wallet: { balance: string; available: string; held: string } | null;
  ticker: MarketTicker | null;
  toasts: Toast[];
  sheet: null | { kind: "merchant"; id: string } | { kind: "pet"; id: string } | { kind: "node"; id: string };
  screen: "world" | "catch" | "pets" | "market" | "ranks" | "wallet" | "fairness";
  petScreen: string | null;
}

export const entities = new Map<string, PetEntity>();

let state: State = {
  token: null, userId: null, displayName: "", network: "", connected: false,
  map: null, nodesDef: [], pois: [], hq: null, nodes: {}, merchants: [], merchantDetail: {},
  own: [], controlled: null, wallet: null, ticker: null, toasts: [], sheet: null, screen: "world", petScreen: null,
};
const subs = new Set<() => void>();

export const store = {
  get: () => state,
  set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const p = typeof patch === "function" ? patch(state) : patch;
    state = { ...state, ...p };
    for (const s of subs) s();
  },
  subscribe(fn: () => void) { subs.add(fn); return () => subs.delete(fn); },
};

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(store.subscribe, () => sel(state));
}

let toastId = 0;
export function toast(kind: Toast["kind"], text: string) {
  const id = ++toastId;
  store.set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
  setTimeout(() => store.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "bad" ? 4200 : 3000);
}

export const controlledPet = (s: State) => s.own.find((p) => p.id === s.controlled) ?? null;

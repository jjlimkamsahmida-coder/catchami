import type { ClientMsg, ServerMsg } from "@catchami/shared";
import { entities, store, toast } from "./store.ts";

const TOKEN_KEY = "catchami.token";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export async function api<T = any>(path: string, body?: unknown, opts: { admin?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = store.get().token;
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (opts.admin) headers["x-admin-token"] = opts.admin;
  let r: Response;
  try {
    r = await fetch(path, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("network", "Can't reach Catchami. Check your connection — nothing was charged.");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(j.error ?? "error", j.message ?? `Request failed (${r.status})`);
  return j as T;
}

export const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

export async function boot() {
  let token: string | null = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch {}
  if (token) {
    store.set({ token });
    try {
      const me = await api("/api/me");
      store.set({ userId: me.user.id, displayName: me.user.displayName, wallet: me.wallet, network: me.wallet.network, onboarding: me.onboarding, nearAccount: me.user.nearAccount });
      connect();
      return;
    } catch { token = null; }
  }
  store.set({ token: null });
}

export async function startAsGuest() {
  const g = await api("/api/auth/guest", {});
  await adoptSession(g.token);
}

/** Use a session token (new guest, NEAR sign-in or phone handoff) for this device. */
export async function adoptSession(token: string) {
  disconnect();
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
  store.set({ token, own: [], controlled: null });
  await refreshWallet();
  connect();
}

export async function refreshWallet() {
  const me = await api("/api/me");
  store.set({ userId: me.user.id, wallet: me.wallet, network: me.wallet.network, displayName: me.user.displayName, onboarding: me.onboarding, nearAccount: me.user.nearAccount });
}

export async function setOnboarding(stage: import("./store.ts").OnboardingStage, tutorial?: number) {
  store.set({ onboarding: { stage, tutorial } });
  await api("/api/onboarding", { stage, tutorial }).catch(() => {});
}

/** Forget this device's account (the account itself stays on the server). */
export function forgetDevice() {
  disconnect();
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  store.set({ token: null, onboarding: null, userId: null, own: [], controlled: null, wallet: null, nearAccount: null });
}

function disconnect() {
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  store.set({ connected: false });
}

let ws: WebSocket | null = null;
let retry = 0;
let clockOffset = 0;

export const serverNow = () => Date.now() + clockOffset;

export function connect() {
  const { token } = store.get();
  if (!token) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return; // one connection per tab
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
  ws.onopen = () => { retry = 0; store.set({ connected: true }); send({ t: "ping", at: Date.now() }); send({ t: "br_sync" }); };
  ws.onclose = () => {
    store.set({ connected: false });
    if (!store.get().token) return;
    const delay = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(connect, delay);
  };
  ws.onmessage = (ev) => onMessage(JSON.parse(ev.data as string) as ServerMsg);
}

setInterval(() => {
  if (ws?.readyState === WebSocket.OPEN) send({ t: "ping", at: Date.now() });
  if (store.get().token && document.visibilityState === "visible") void refreshWallet().catch(() => {});
}, 12_000);

export function send(msg: ClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function onMessage(m: ServerMsg) {
  const now = serverNow();
  switch (m.t) {
    case "welcome":
      store.set({ map: m.map, nodesDef: m.nodes, pois: m.pois, hq: m.hq, controlled: m.controlled, displayName: m.displayName });
      break;
    case "snap": {
      const seen = new Set<string>();
      for (const [id, x, y, anim, facing] of m.p) {
        seen.add(id);
        let e = entities.get(id);
        if (!e) { e = { id, meta: null, samples: [], anim, facing, lastSeen: now }; entities.set(id, e); }
        e.samples.push([now, x, y]);
        if (e.samples.length > 8) e.samples.shift();
        e.anim = anim; e.facing = facing; e.lastSeen = now;
      }
      for (const [id, e] of entities) if (!seen.has(id) && now - e.lastSeen > 2000) entities.delete(id);
      store.set({ merchants: m.m, bandits: m.b ?? [] });
      break;
    }
    case "meta": {
      for (const p of m.pets) { const e = entities.get(p.id); if (e) e.meta = p; }
      store.set((s) => ({ nodes: { ...s.nodes, ...Object.fromEntries(m.nodes.map((n) => [n.id, n.remaining])) } }));
      break;
    }
    case "own": {
      const prev = store.get().own.length;
      store.set((s) => ({ own: m.pets, controlled: m.controlled ?? s.controlled }));
      if (m.pets.length !== prev) void refreshWallet().catch(() => {});
      break;
    }
      break;
    case "merchant":
      if (m.detail) store.set((s) => ({ merchantDetail: { ...s.merchantDetail, [m.id]: { detail: m.detail!, at: Date.now() } } }));
      break;
    case "market":
      store.set({ ticker: m.ticker });
      break;
    case "battle":
      window.dispatchEvent(new CustomEvent("catchami:battle", { detail: m.battle }));
      break;
    case "toast":
      toast(m.kind, m.text);
      if (m.kind === "good") void refreshWallet().catch(() => {});
      break;
    case "error":
      toast("bad", m.message);
      break;
    case "mg_round":
      store.set({ minigame: { round: m.round, receivedAt: performance.now() } });
      break;
    case "mg_result":
      store.set((s) => ({ minigame: s.minigame?.round.id === m.roundId ? null : s.minigame, mgResult: { roundId: m.roundId, grade: m.grade, gained: m.gained, resource: m.resource, detail: m.detail, note: m.note, at: performance.now() } }));
      window.dispatchEvent(new CustomEvent("catchami:gathered", { detail: m }));
      break;
    case "mg_end":
      store.set({ minigame: null });
      toast("info", m.reason);
      break;
    case "br_invite":
      store.set({ bubbleInvite: { matchId: m.matchId, fromName: m.from.name, ownerName: m.from.ownerName, sticker: m.from.sticker, species: m.from.species, look: m.from.look, toPetId: m.toPetId, expiresAt: m.expiresAt } });
      break;
    case "br_state":
      store.set((s) => ({
        bubble: m.match,
        bubbleInvite: s.bubbleInvite?.matchId === m.match.id && m.match.state !== "invited" ? null : s.bubbleInvite,
      }));
      break;
    case "bandit_duel":
      store.set({ banditDuel: { duelId: m.duelId, banditName: m.banditName, petName: m.petName, brave: m.brave, practice: m.practice, rounds: m.rounds, deadlineMs: m.deadlineMs, at: Date.now() }, sheet: null, minigame: null });
      break;
    case "bandit_fight":
      store.set({ banditFight: { banditName: m.banditName, petName: m.petName, won: m.won, stolen: m.stolen, brave: m.brave, at: Date.now() } });
      break;
    case "pong":
      clockOffset = m.serverTime - (m.at + Date.now()) / 2;
      break;
  }
}

export function signOut() {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  location.assign("/");
}

// Debugging hook, dev builds only.
if (import.meta.env.DEV) (window as unknown as { __catchamiDev: unknown }).__catchamiDev = { store, send };

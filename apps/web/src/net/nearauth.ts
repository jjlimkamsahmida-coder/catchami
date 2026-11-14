/**
 * NEAR Auth (Google / Apple / email / passkey) — https://docs.auth.near.org
 *
 * Sign-in: Auth0 popup -> we send the ID token to our server, which verifies
 * it and derives the player's NEAR account (an implicit account whose key is
 * held by NEAR's MPC signer network, bound to their Google login).
 *
 * Transactions: the player approves the exact transaction in the NEAR Auth
 * popup; our server relays the `sign` call to the NEAR Auth contract (paying
 * its gas); the MPC signature comes back and the browser broadcasts the
 * signed transaction from the player's own account.
 */
import { api } from "./api.ts";

const ENV = import.meta.env as Record<string, string | undefined>;
export const NEAR_AUTH = {
  network: "testnet" as const,
  // Shared NEAR Auth client for testnet apps (docs.auth.near.org/resources/testnet), unless this site has its own.
  clientId: ENV.VITE_NEAR_AUTH_CLIENT_ID || "np8paqIpMWmNbzT4xAvOOapZBjsOpptl",
  // Sites the NEAR Auth login allows as a return address. The shared client only allows http://localhost:3000.
  origins: (ENV.VITE_NEAR_AUTH_ORIGINS || "http://localhost:3000").split(",").map((s) => s.trim()),
  rpc: "https://test.rpc.fastnear.com",
};
/** NEAR Auth only works on sites its login has approved. */
export const nearAuthAvailable = () => NEAR_AUTH.origins.includes(location.origin);
export const NEAR_AUTH_PENDING_MSG = "Google sign-in (NEAR Auth) is waiting for NEAR to approve this website. Play as a guest or connect a NEAR wallet for now — you can link Google later.";
const PENDING = "catchami.nearauth.pending";
const KEY = "catchami.nearauth";

type Provider = import("@fast-auth-near/javascript-provider").JavascriptProvider;
let provider: Provider | null = null;
async function prov(): Promise<Provider> {
  if (provider) return provider;
  const { Buffer } = await import("buffer");
  const g = globalThis as unknown as { Buffer?: unknown; global?: unknown; process?: { env: Record<string, string> } };
  g.Buffer ??= Buffer; g.global ??= globalThis; g.process ??= { env: {} };
  const { JavascriptProvider } = await import("@fast-auth-near/javascript-provider");
  provider = new JavascriptProvider({ network: NEAR_AUTH.network, clientId: NEAR_AUTH.clientId });
  return provider;
}

export interface NearAuthSession { accountId: string; publicKey: string }
export const nearAuthSession = (): NearAuthSession | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };
const saveSession = (s: NearAuthSession | null) => { try { if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private mode */ } };
export const isNearAuthAccount = (accountId: string) => nearAuthSession()?.accountId === accountId;

async function idToken(p: Provider): Promise<string> {
  const claims = await (p as unknown as { client: { getIdTokenClaims(): Promise<{ __raw?: string } | undefined> } }).client.getIdTokenClaims();
  if (!claims?.__raw) throw new Error("Sign-in didn't finish — try again");
  return claims.__raw;
}

/** Google (or email/passkey) sign-in through NEAR Auth. Must be called from a click (it opens a popup). */
export async function signInWithNearAuth(): Promise<{ token: string; accountId: string; created: boolean }> {
  if (!nearAuthAvailable()) throw new Error(NEAR_AUTH_PENDING_MSG);
  const p = await prov();
  try {
    await p.login();
  } catch (e) {
    // Pop-up blocked (in-app browsers, some phones): go there and come back instead.
    if (/popup|window/i.test(String((e as Error)?.message ?? e))) {
      try { sessionStorage.setItem(PENDING, "signin"); } catch { /* private mode */ }
      await p.login({ redirectUri: `${location.origin}/` });
      return new Promise(() => {}); // the page is navigating away
    }
    throw e;
  }
  return finishSignIn(p);
}
async function finishSignIn(p: Provider) {
  const r = await api<{ token: string; accountId: string; publicKey: string; created: boolean }>("/api/auth/near-auth", { idToken: await idToken(p) });
  saveSession({ accountId: r.accountId, publicKey: r.publicKey });
  return r;
}

/** After a redirect sign-in: finish it (call once at app start). Returns null when there's nothing to finish. */
export async function finishNearAuthRedirect(): Promise<{ token: string; accountId: string; created: boolean } | null> {
  let pending: string | null = null;
  try { pending = sessionStorage.getItem(PENDING); } catch { pending = null; }
  const q = new URLSearchParams(location.search);
  if (!pending || !q.has("code") || !q.has("state")) return null;
  try { sessionStorage.removeItem(PENDING); } catch { /* ignore */ }
  const p = await prov();
  if (!(await p.isLoggedIn())) return null; // completes the Auth0 callback
  history.replaceState(null, "", location.pathname);
  return finishSignIn(p);
}

/** Link NEAR Auth to the current player (guest -> Google). */
export async function linkNearAuth(): Promise<{ accountId: string }> {
  if (!nearAuthAvailable()) throw new Error(NEAR_AUTH_PENDING_MSG);
  const p = await prov();
  await p.login();
  const r = await api<{ accountId: string; publicKey: string }>("/api/near-auth/link", { idToken: await idToken(p) });
  saveSession({ accountId: r.accountId, publicKey: r.publicKey });
  return r;
}

export async function signOutNearAuth() {
  saveSession(null);
  try { await (await prov()).logout({ openUrl: false } as never); } catch { /* not signed in */ }
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(NEAR_AUTH.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "c", method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.data?.toString?.() ?? j.error.message ?? "RPC error");
  return j.result as T;
}

/** 64-byte ed25519 signature from the MPC result (see the NEAR Auth SDK's FastAuthSignature). */
function recoverEd25519(payload: { signature?: number[]; big_r?: { affine_point?: string }; s?: { scalar?: string } }): Uint8Array {
  if (Array.isArray(payload.signature)) return Uint8Array.from(payload.signature);
  const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
  let R = hex(payload.big_r!.affine_point!), S = hex(payload.s!.scalar!);
  if (R.length === 33) R = R.slice(1);
  const pad = (a: Uint8Array) => (a.length > 32 ? a.slice(a.length - 32) : Uint8Array.from([...new Array(32 - a.length).fill(0), ...a]));
  return Uint8Array.from([...pad(R), ...pad(S)]);
}

/** Sign (in the NEAR Auth popup) and send one function call from the player's NEAR Auth account. */
export async function nearAuthSignAndSend(c: { receiverId: string; methodName: string; args: Record<string, unknown>; gasTgas?: number; depositYocto?: bigint }): Promise<{ value: unknown; txHash: string | null }> {
  const s = nearAuthSession();
  if (!s) throw new Error("Sign in with Google again to approve this");
  const p = await prov();
  const { transactions, utils } = await import("near-api-js");
  const ak = await rpc<{ nonce: number; block_hash: string }>("query", { request_type: "view_access_key", finality: "final", account_id: s.accountId, public_key: s.publicKey });
  const tx = transactions.createTransaction(
    s.accountId, utils.PublicKey.from(s.publicKey), c.receiverId, BigInt(ak.nonce) + 1n,
    [transactions.functionCall(c.methodName, c.args, BigInt(c.gasTgas ?? 100) * 10n ** 12n, c.depositYocto ?? 0n)],
    utils.serialize.base_decode(ak.block_hash),
  );
  await p.requestTransactionSignature({ transaction: tx as never });
  const { signatureRequest } = await p.getSignatureRequest();
  const { payload } = await api<{ payload: Parameters<typeof recoverEd25519>[0] }>("/api/near-auth/sign", {
    guardId: signatureRequest.guardId, verifyPayload: signatureRequest.verifyPayload, signPayload: Array.from(signatureRequest.signPayload as ArrayLike<number>),
  });
  const signed = new transactions.SignedTransaction({ transaction: tx, signature: new transactions.Signature({ keyType: 0, data: recoverEd25519(payload) }) });
  const { Buffer } = await import("buffer");
  const out = await rpc<{ status?: { SuccessValue?: string; Failure?: unknown }; transaction?: { hash?: string } }>("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "EXECUTED_OPTIMISTIC" });
  if (out.status?.Failure) throw new Error(JSON.stringify(out.status.Failure).slice(0, 200));
  let value: unknown = null;
  if (out.status?.SuccessValue) { try { value = JSON.parse(atob(out.status.SuccessValue)); } catch { value = null; } }
  return { value, txHash: out.transaction?.hash ?? null };
}

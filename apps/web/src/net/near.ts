/**
 * NEAR wallets: sign-in with a NEP-413 signed message (no gas, no seed
 * phrase), and — once signed in — transactions the player signs themselves
 * (withdrawing a pet's $CATCHAMI, swapping it for USDC).
 *
 * MyNearWallet is not offered: it has been sunset.
 */
import { api } from "./api.ts";

export type WalletId = "meteor-wallet" | "here-wallet" | "intear-wallet" | "sender";
export const WALLETS: Array<{ id: WalletId; name: string; note: string; icon: string }> = [
  { id: "meteor-wallet", name: "Meteor Wallet", note: "Web wallet or extension · testnet ready", icon: "☄️" },
  { id: "intear-wallet", name: "Intear Wallet", note: "Web wallet", icon: "🟣" },
  { id: "here-wallet", name: "HERE Wallet", note: "Phone app (scan a QR)", icon: "📱" },
  { id: "sender", name: "Sender", note: "Browser extension", icon: "🧩" },
];

interface Challenge { message: string; recipient: string; nonce: string; network: "testnet" | "mainnet" }

type Selector = Awaited<ReturnType<typeof makeSelector>>;
async function makeSelector(network: "testnet" | "mainnet") {
  // The wallet modules expect a few Node globals in the browser.
  const { Buffer } = await import("buffer");
  const g = globalThis as unknown as { Buffer?: unknown; global?: unknown; process?: { env: Record<string, string> } };
  g.Buffer ??= Buffer;
  g.global ??= globalThis;
  g.process ??= { env: {} };
  const [{ setupWalletSelector }, { setupMeteorWallet }, { setupHereWallet }, { setupIntearWallet }, { setupSender }] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/meteor-wallet"),
    import("@near-wallet-selector/here-wallet"),
    import("@near-wallet-selector/intear-wallet"),
    import("@near-wallet-selector/sender"),
  ]);
  return setupWalletSelector({ network, modules: [setupMeteorWallet(), setupIntearWallet(), setupHereWallet(), setupSender()] });
}
let selPromise: Promise<Selector> | null = null;
function selector(network: "testnet" | "mainnet") {
  selPromise ??= makeSelector(network);
  selPromise.catch(() => { selPromise = null; });
  return selPromise;
}

// Pre-loaded wallet code and a fresh challenge, so the click that opens the
// wallet pop-up happens immediately (browsers block pop-ups opened too long
// after the click).
let ready: Promise<{ ch: Challenge; sel: Selector; at: number }> | null = null;
export function prepareNear() {
  ready = (async () => { const ch = await api<Challenge>("/api/near/challenge", {}); return { ch, sel: await selector(ch.network), at: Date.now() }; })();
  ready.catch(() => { ready = null; });
  return ready;
}

const LAST = "catchami.wallet";
const remember = (id: WalletId) => { try { localStorage.setItem(LAST, id); } catch { /* private mode */ } };
export const lastWallet = (): WalletId | null => { try { return localStorage.getItem(LAST) as WalletId | null; } catch { return null; } };

/** Ask the wallet to sign the challenge. Returns the signed proof for the server. */
async function sign(walletId: WalletId): Promise<Record<string, string>> {
  let r = ready ? await ready.catch(() => null) : null;
  if (!r || Date.now() - r.at > 8 * 60_000) r = await prepareNear();
  ready = null; // a challenge is single use
  const { ch, sel } = r;
  const wallet = await sel.wallet(walletId);
  const { Buffer } = await import("buffer");
  const callbackUrl = location.href;
  const signed = await wallet.signMessage({ message: ch.message, recipient: ch.recipient, nonce: Buffer.from(ch.nonce, "base64"), callbackUrl });
  if (!signed || !signed.signature) throw new Error("The wallet didn't return a signature. Try again.");
  remember(walletId);
  return { accountId: signed.accountId, publicKey: signed.publicKey, signature: signed.signature, nonce: ch.nonce, callbackUrl };
}

/** Sign in (or create a player) with a NEAR wallet. Returns a session token. */
export async function signInWithNear(walletId: WalletId): Promise<{ token: string; accountId: string; created: boolean }> {
  const proof = await sign(walletId);
  return api("/api/auth/near", proof);
}

/** Link a NEAR wallet to the current player. */
export async function linkNear(walletId: WalletId): Promise<{ accountId: string }> {
  const proof = await sign(walletId);
  return api("/api/near/link", proof);
}

// ---------------------------------------------------------- transactions --

export interface Call { receiverId: string; methodName: string; args: Record<string, unknown>; gasTgas?: number; depositYocto?: bigint }

/** Make sure the wallet is signed in as `accountId` (needed before it will sign transactions). */
async function walletFor(accountId: string, contractId: string, walletId?: WalletId | null) {
  const network = accountId.endsWith(".near") ? "mainnet" : "testnet";
  const sel = await selector(network);
  const id = walletId ?? lastWallet() ?? "meteor-wallet";
  const wallet = await sel.wallet(id);
  const accounts = await wallet.getAccounts().catch(() => []);
  if (!accounts.some((a) => a.accountId === accountId)) {
    await wallet.signIn({ contractId, methodNames: [], accounts: [] } as never);
    const now = await wallet.getAccounts().catch(() => []);
    if (!now.some((a) => a.accountId === accountId)) throw new Error(`Switch your wallet to ${accountId} and try again`);
  }
  return wallet;
}

/** Sign and send one transaction with the player's own wallet. Returns the decoded return value. */
export async function signAndSend(accountId: string, c: Call, walletId?: WalletId | null): Promise<{ value: unknown; txHash: string | null }> {
  const wallet = await walletFor(accountId, c.receiverId, walletId);
  const { actionCreators } = await import("@near-js/transactions");
  const action = actionCreators.functionCall(c.methodName, c.args, BigInt(c.gasTgas ?? 100) * 10n ** 12n, c.depositYocto ?? 0n);
  const out = await wallet.signAndSendTransaction({ signerId: accountId, receiverId: c.receiverId, actions: [action] } as never) as unknown as {
    status?: { SuccessValue?: string; Failure?: unknown }; transaction?: { hash?: string }; transaction_outcome?: { id?: string };
  } | void;
  if (!out) return { value: null, txHash: null };
  if (out.status && "Failure" in out.status && out.status.Failure) throw new Error(JSON.stringify(out.status.Failure).slice(0, 200));
  let value: unknown = null;
  const sv = out.status?.SuccessValue;
  if (sv) { try { value = JSON.parse(atob(sv)); } catch { value = null; } }
  return { value, txHash: out.transaction?.hash ?? out.transaction_outcome?.id ?? null };
}

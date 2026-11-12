/**
 * NEAR testnet wallet connection via NEP-413 signed messages.
 * The wallet signs a one-time server challenge; the server checks the
 * signature and that the key is a full-access key of the account. No
 * transaction, no gas, and Catchami never sees a seed phrase or private key.
 */
import { api } from "./api.ts";

export type WalletId = "my-near-wallet" | "meteor-wallet";
export const WALLETS: Array<{ id: WalletId; name: string; note: string }> = [
  { id: "meteor-wallet", name: "Meteor Wallet", note: "Browser extension or web wallet" },
  { id: "my-near-wallet", name: "MyNearWallet", note: "Web wallet (opens a pop-up)" },
];

interface Challenge { message: string; recipient: string; nonce: string; network: "testnet" | "mainnet" }

async function selector(network: "testnet" | "mainnet") {
  // The wallet modules expect a few Node globals in the browser.
  const { Buffer } = await import("buffer");
  const g = globalThis as unknown as { Buffer?: unknown; global?: unknown; process?: { env: Record<string, string> } };
  g.Buffer ??= Buffer;
  g.global ??= globalThis;
  g.process ??= { env: {} };
  const [{ setupWalletSelector }, { setupMyNearWallet }, { setupMeteorWallet }] = await Promise.all([
    import("@near-wallet-selector/core"),
    import("@near-wallet-selector/my-near-wallet"),
    import("@near-wallet-selector/meteor-wallet"),
  ]);
  return setupWalletSelector({ network, modules: [setupMyNearWallet(), setupMeteorWallet()] });
}

// Pre-loaded wallet code and a fresh challenge, so the click that opens the
// wallet pop-up happens immediately (browsers block pop-ups opened too long
// after the click).
let ready: Promise<{ ch: Challenge; sel: Awaited<ReturnType<typeof selector>>; at: number }> | null = null;
export function prepareNear() {
  ready = (async () => { const ch = await api<Challenge>("/api/near/challenge", {}); return { ch, sel: await selector(ch.network), at: Date.now() }; })();
  ready.catch(() => { ready = null; });
  return ready;
}

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

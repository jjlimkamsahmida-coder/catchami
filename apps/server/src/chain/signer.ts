/**
 * Server-side NEAR signers. Keys come only from the host's secret store
 * (an env secret or a key file path) — never from the repo or the browser.
 *
 *  - operator: mints NFTs, submits settlement batches, moves custody NFTs.
 *  - market:   the 55% market allocation; delivers $CATCHAMI that players buy.
 */
import { readFileSync } from "node:fs";
import { Account, KeyPair, KeyPairSigner, providers } from "near-api-js";
import { env } from "../env.ts";

export const rpcUrl = () => env.near.rpcUrl ?? (env.network === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");

let provider: InstanceType<typeof providers.JsonRpcProvider> | null = null;
export function rpcProvider() {
  provider ??= new providers.JsonRpcProvider({ url: rpcUrl() });
  return provider;
}

function loadKey(inline: string | null, file: string | null): string | null {
  if (inline) return inline.trim();
  if (!file) return null;
  const j = JSON.parse(readFileSync(file, "utf8")) as { private_key?: string; secret_key?: string };
  return j.private_key ?? j.secret_key ?? null;
}

const cache = new Map<string, Account>();
function account(id: string | null, inline: string | null, file: string | null): Account | null {
  if (!id) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const key = loadKey(inline, file);
  if (!key) return null;
  const a = new Account(id, rpcProvider(), new KeyPairSigner(KeyPair.fromString(key as `ed25519:${string}`)));
  cache.set(id, a);
  return a;
}

export const operator = () => account(env.near.operatorAccount, env.near.operatorKey, env.near.operatorKeyFile);
export const market = () => account(env.near.marketAccount, env.near.marketKey, env.near.marketKeyFile);

/** True when the server can sign as the operator (mints + settlement). */
export const canSign = () => {
  try { return Boolean(env.near.gameContract && env.near.tokenContract && operator()); } catch { return false; }
};
export const canSell = () => {
  try { return Boolean(env.near.tokenContract && env.near.gameContract && market()); } catch { return false; }
};

export interface CallResult { txHash: string; value: unknown }

/** Sign and send one function call; throws with the contract's panic message on failure. */
export async function call(signer: Account, contractId: string, methodName: string, args: Record<string, unknown>, opts: { gasTgas?: number; depositYocto?: bigint } = {}): Promise<CallResult> {
  const out = await signer.callFunctionRaw({
    contractId, methodName, args,
    gas: BigInt(opts.gasTgas ?? 100) * 10n ** 12n,
    deposit: opts.depositYocto ?? 0n,
    waitUntil: "EXECUTED_OPTIMISTIC",
  });
  const txHash = out.transaction_outcome?.id ?? (out as { transaction?: { hash?: string } }).transaction?.hash ?? "";
  const status = out.status as { SuccessValue?: string; Failure?: unknown };
  const failed = [out.transaction_outcome, ...(out.receipts_outcome ?? [])].map((o) => (o?.outcome?.status as { Failure?: unknown } | undefined)?.Failure).find(Boolean);
  if (status?.Failure || failed) {
    const f = JSON.stringify(status?.Failure ?? failed);
    const m = /"error_message"\s*:\s*"([^"]+)"/.exec(f) ?? /ExecutionError"\s*:\s*"([^"]+)"/.exec(f);
    const err = new Error(m?.[1] ?? f.slice(0, 300)) as Error & { txHash?: string };
    err.txHash = txHash;
    throw err;
  }
  let value: unknown = null;
  if (typeof status?.SuccessValue === "string" && status.SuccessValue.length) {
    try { value = JSON.parse(Buffer.from(status.SuccessValue, "base64").toString()); } catch { value = null; }
  }
  return { txHash, value };
}

/** Read-only contract call. */
export async function view<T>(contractId: string, methodName: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await rpcProvider().callFunction(contractId, methodName, args)) as T;
}

export const ONE_YOCTO = 1n;
export const NEAR = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;

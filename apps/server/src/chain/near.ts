/**
 * Minimal NEAR JSON-RPC client for read-only checks (reconciliation and the
 * deposit indexer). Signing lives in a separate operator service that loads
 * its key from the secret store — never from this repo or the browser.
 */
import { env } from "../env.ts";

async function rpc<T>(method: string, params: unknown): Promise<T> {
  if (!env.near.rpcUrl) throw new Error("NEAR_RPC_URL not configured");
  const r = await fetch(env.near.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "catchami", method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  const j = (await r.json()) as { result?: T; error?: { message: string; data?: unknown } };
  if (j.error) throw new Error(`${j.error.message} ${JSON.stringify(j.error.data ?? "")}`);
  return j.result as T;
}

export async function viewCall<T>(contract: string, method: string, args: Record<string, unknown>): Promise<T> {
  const res = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(res.result).toString()) as T;
}

export async function ftBalanceOf(token: string, account: string): Promise<bigint> {
  return BigInt(await viewCall<string>(token, "ft_balance_of", { account_id: account }));
}

export interface ChainDeposit { seq: number; sender: string; amount: string; target: { user?: string; pet?: string; hq?: boolean } ; block: number }

/** Reads deposits recorded by the game contract since `fromSeq` (see contracts/game). */
export async function depositsSince(fromSeq: number, limit = 100): Promise<ChainDeposit[]> {
  return viewCall<ChainDeposit[]>(env.near.gameContract!, "deposits_since", { from_seq: fromSeq, limit });
}

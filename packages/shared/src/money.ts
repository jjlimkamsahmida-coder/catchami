/**
 * Exact integer token accounting. Every amount is a bigint in base units
 * (1 $CATCHAMI = 10^18 base units). Floating point never touches money.
 */

export const DECIMALS = 18;
export const ONE = 10n ** BigInt(DECIMALS);
/** 100 trillion whole tokens, fixed. */
export const TOTAL_SUPPLY_WHOLE = 100_000_000_000_000n;
export const TOTAL_SUPPLY = TOTAL_SUPPLY_WHOLE * ONE;
export const BPS = 10_000n;

/** Whole tokens -> base units. */
export function tokens(whole: bigint | number | string): bigint {
  if (typeof whole === "number") {
    if (!Number.isSafeInteger(whole)) throw new Error(`tokens(): ${whole} is not a safe integer`);
    return BigInt(whole) * ONE;
  }
  return BigInt(whole) * ONE;
}

/** floor(amount * bps / 10000). */
export function bps(amount: bigint, basisPoints: number): bigint {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    throw new Error(`invalid basis points ${basisPoints}`);
  }
  return (amount * BigInt(basisPoints)) / BPS;
}

/**
 * Split `amount` into named parts by basis points. Parts must sum to 10000.
 * Rounding dust is assigned to `remainderTo` so the parts always sum to
 * exactly `amount`.
 */
export function splitBps<P extends Record<string, number>>(
  amount: bigint,
  parts: P,
  remainderTo: keyof P & string,
): Record<keyof P & string, bigint> {
  type K = keyof P & string;
  if (amount < 0n) throw new Error("cannot split a negative amount");
  const keys = Object.keys(parts) as K[];
  const total = keys.reduce((s, k) => s + (parts[k] as number), 0);
  if (total !== 10_000) throw new Error(`split parts sum to ${total}, expected 10000`);
  if (!(remainderTo in parts)) throw new Error(`remainder key ${remainderTo} not in parts`);
  const out = {} as Record<K, bigint>;
  let assigned = 0n;
  for (const k of keys) {
    out[k] = bps(amount, parts[k] as number);
    assigned += out[k];
  }
  out[remainderTo] += amount - assigned;
  return out;
}

export function minBig(...xs: bigint[]): bigint {
  return xs.reduce((a, b) => (b < a ? b : a));
}
export function maxBig(...xs: bigint[]): bigint {
  return xs.reduce((a, b) => (b > a ? b : a));
}

/** Parse a decimal string of whole tokens ("1.5", "1000") into base units. */
export function parseTokens(input: string): bigint {
  const s = input.trim().replace(/[_,\s]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`invalid token amount "${input}"`);
  const whole = m[1]!;
  const frac = (m[2] ?? "").slice(0, DECIMALS).padEnd(DECIMALS, "0");
  return BigInt(whole) * ONE + BigInt(frac);
}

/** Exact decimal string, trimmed trailing zeros. */
export function toDecimalString(amount: bigint): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const whole = a / ONE;
  const frac = (a % ONE).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

const UNITS: Array<[bigint, string]> = [
  [10n ** 12n, "T"],
  [10n ** 9n, "B"],
  [10n ** 6n, "M"],
  [10n ** 3n, "K"],
];

/** Human display: 1.25M, 980K, 12.4T. Truncates (never rounds up a balance). */
export function formatTokens(amount: bigint, opts: { compact?: boolean } = {}): string {
  const neg = amount < 0n;
  const a = neg ? -amount : amount;
  const whole = a / ONE;
  const sign = neg ? "-" : "";
  if (opts.compact !== false) {
    for (const [div, suffix] of UNITS) {
      if (whole >= div) {
        const hundredths = (whole * 100n) / div;
        const int = hundredths / 100n;
        const dec = hundredths % 100n;
        const decStr = int >= 100n ? "" : int >= 10n ? `.${dec / 10n}`.replace(/\.0$/, "") : `.${dec.toString().padStart(2, "0")}`.replace(/\.?0+$/, "");
        return `${sign}${int}${decStr}${suffix}`;
      }
    }
  }
  if (whole === 0n && a > 0n) return `${sign}<1`;
  return `${sign}${whole.toLocaleString("en-US")}`;
}

/** JSON-safe wire form for bigint amounts. */
export type Amount = string;
export const toWire = (a: bigint): Amount => a.toString();
export const fromWire = (s: Amount): bigint => {
  if (!/^-?\d+$/.test(s)) throw new Error(`invalid wire amount ${s}`);
  return BigInt(s);
};

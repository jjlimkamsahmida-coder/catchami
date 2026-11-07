/**
 * Auditable randomness (commit-reveal).
 *
 * The server generates a secret seed per epoch and publishes sha256(seed)
 * BEFORE the epoch's rolls happen. Every roll is derived as
 *   HMAC-SHA256(seed, label)
 * where `label` contains the attempt id and the player's nonce. After the
 * epoch the seed is revealed; anyone can recompute every outcome with
 * verifyCommitment() + Rng. The browser never supplies the random value.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

export function commitmentOf(seedHex: string): string {
  return bytesToHex(sha256(hexToBytes(seedHex)));
}

export function verifyCommitment(seedHex: string, commitmentHex: string): boolean {
  return commitmentOf(seedHex) === commitmentHex.toLowerCase();
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

/**
 * Deterministic generator. Seeded from HMAC(seed, label); uses sfc32 for the
 * stream and rejection sampling so integer ranges are exactly uniform.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seedHex: string, label: string) {
    const h = hmac(sha256, hexToBytes(seedHex), utf8ToBytes(label));
    const v = new DataView(h.buffer, h.byteOffset, h.byteLength);
    this.a = v.getUint32(0);
    this.b = v.getUint32(4);
    this.c = v.getUint32(8);
    this.d = v.getUint32(12);
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  /** Seed from an arbitrary string (non-financial uses: map decoration, sim). */
  static fromString(s: string): Rng {
    return new Rng(sha256Hex(s), "catchami");
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform integer in [0, n). n <= 2^32. */
  int(n: number): number {
    if (!Number.isInteger(n) || n <= 0 || n > 2 ** 32) throw new Error(`Rng.int: bad n ${n}`);
    const limit = Math.floor(2 ** 32 / n) * n;
    for (;;) {
      const x = this.nextU32();
      if (x < limit) return x % n;
    }
  }

  /** Uniform integer in [lo, hi]. */
  range(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  /** true with probability ppm / 1e6. */
  chancePpm(ppm: number): boolean {
    return this.int(1_000_000) < ppm;
  }

  /** Float in [0,1) — only for non-financial cosmetics/movement. */
  float(): number {
    return this.nextU32() / 2 ** 32;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]!;
  }

  /** Pick a key from a ppm table that sums to 1e6. */
  weightedPpm<K extends string>(table: Record<K, number>): K {
    const keys = Object.keys(table) as K[];
    const total = keys.reduce((s, k) => s + table[k], 0);
    if (total !== 1_000_000) throw new Error(`ppm table sums to ${total}`);
    let r = this.int(1_000_000);
    for (const k of keys) {
      r -= table[k];
      if (r < 0) return k;
    }
    return keys[keys.length - 1]!;
  }
}

export function randomSeedHex(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return bytesToHex(b);
}

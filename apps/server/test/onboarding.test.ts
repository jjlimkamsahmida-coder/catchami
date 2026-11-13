import { describe, expect, it, beforeAll } from "vitest";
import { generateKeyPairSync, sign, verify } from "node:crypto";
import { AREAS, battlesAllowed, ECONOMY, findPath, generateWorld, rollCatch, tileCenter, tokens } from "@catchami/shared";
import { openDb, type Db } from "../src/db/index.ts";
import { ensureGenesis } from "../src/ledger/treasury.ts";
import { createGuest } from "../src/auth.ts";
import { acct, balanceOf } from "../src/ledger/ledger.ts";
import { createHandoff, getOnboarding, LINK_MESSAGE, LINK_RECIPIENT, nep413Digest, redeemHandoff, setOnboarding, starterGrant } from "../src/onboarding.ts";

let db: Db;
beforeAll(async () => { db = await openDb(); await ensureGenesis(db); }, 60_000);

describe("three-area world", () => {
  const w = generateWorld();
  it("has a village with no resources, and forest/mines with the right ones", () => {
    const by: Record<string, Set<string>> = {};
    for (const n of w.nodes) (by[AREAS[w.area[n.ty * w.w + n.tx]!]!.id] ??= new Set()).add(n.resource);
    expect(by.village).toBeUndefined();
    expect([...by.forest!].sort()).toEqual(["fish", "herbs", "wood"]);
    expect([...by.mines!]).toEqual(["minerals"]);
  });
  it("every landmark and resource spot is reachable from HQ", () => {
    const hq = w.pois.find((p) => p.id === "hq")!;
    for (const p of w.pois.filter((q) => !q.id.startsWith("glade"))) expect(findPath(w, hq.tx, hq.ty, p.tx, p.ty, 300_000), p.id).not.toBeNull();
  });
  it("battles are off in the village and on in the wild", () => {
    const at = (id: string) => { const p = w.pois.find((q) => q.id === id)!; return battlesAllowed(w, tileCenter(p.tx), tileCenter(p.ty)); };
    expect(at("hq")).toBe(false);
    expect(at("forest")).toBe(true);
    expect(at("mines")).toBe(true);
  });
});

describe("new-player journey", () => {
  it("tracks the story stage and grants starter coins exactly once", async () => {
    const u = await createGuest(db);
    expect((await getOnboarding(db, u.userId)).stage).toBe("intro");
    await setOnboarding(db, u.userId, "tutorial", 2);
    expect(await getOnboarding(db, u.userId)).toMatchObject({ stage: "tutorial", tutorial: 2 });
    await expect(setOnboarding(db, u.userId, "nope", 0)).rejects.toThrow();
    const a = await starterGrant(db, u.userId, "bloom"), b = await starterGrant(db, u.userId, "grove");
    expect(a.already).toBe(false);
    expect(b.already).toBe(true);
    const bal = await db.tx((tx) => balanceOf(tx, acct.user(u.userId)));
    expect(bal.balance).toBe(tokens(ECONOMY.catch.starterPacks.find((p) => p.id === "bloom")!.whole));
  });
  it("phone hand-off codes work once and give the same account", async () => {
    const u = await createGuest(db);
    const h = createHandoff(u.userId);
    expect(redeemHandoff(h.code).userId).toBe(u.userId);
    expect(() => redeemHandoff(h.code)).toThrow();
    expect(() => redeemHandoff("made-up")).toThrow();
  });
  it("a first catch is guaranteed but rarity still comes from the fair roll", () => {
    const seed = "ab".repeat(32);
    for (let i = 0; i < 40; i++) {
      const normal = rollCatch(seed, `l${i}`, "basic"), first = rollCatch(seed, `l${i}`, "basic", true);
      expect(first.success).toBe(true);
      expect(first.successDraw).toBe(normal.successDraw);
      if (normal.success) expect(first.rarity).toBe(normal.rarity);
    }
  });
  it("verifies NEP-413 signatures over the exact payload", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const nonce = Buffer.alloc(32, 7);
    const digest = nep413Digest(LINK_MESSAGE, nonce, LINK_RECIPIENT, null);
    const sig = sign(null, digest, privateKey);
    expect(verify(null, digest, publicKey, sig)).toBe(true);
    // Any change to message, nonce, recipient or callback breaks it.
    expect(verify(null, nep413Digest("other", nonce, LINK_RECIPIENT, null), publicKey, sig)).toBe(false);
    expect(verify(null, nep413Digest(LINK_MESSAGE, Buffer.alloc(32, 8), LINK_RECIPIENT, null), publicKey, sig)).toBe(false);
    expect(verify(null, nep413Digest(LINK_MESSAGE, nonce, "evil.app", null), publicKey, sig)).toBe(false);
    expect(verify(null, nep413Digest(LINK_MESSAGE, nonce, LINK_RECIPIENT, "https://x"), publicKey, sig)).toBe(false);
    // Tag prefix is 2^31 + 413, little-endian.
    expect(digest.length).toBe(32);
  });
});

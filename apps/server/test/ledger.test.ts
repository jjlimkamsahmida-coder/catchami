import { describe, expect, it, beforeAll } from "vitest";
import { tokens } from "@catchami/shared";
import { openDb, type Db } from "../src/db/index.ts";
import {
  acct, balanceOf, captureHold, ensureAccount, ensureSystemAccounts, LedgerError, placeHold, post, releaseHold, transfer, trialBalance,
} from "../src/ledger/ledger.ts";

let db: Db;
beforeAll(async () => {
  db = await openDb();
  await db.tx(async (tx) => {
    await ensureSystemAccounts(tx);
    await ensureAccount(tx, acct.user("u1"), "user", { userId: "u1" });
    await ensureAccount(tx, acct.pet("p1"), "pet", { petId: "p1" });
  });
});

describe("ledger", () => {
  it("deposits are idempotent", async () => {
    const dep = { idem: "dep:1", kind: "deposit", postings: transfer(acct.chain, acct.user("u1"), tokens(1000)) };
    const a = await db.tx((tx) => post(tx, dep));
    const b = await db.tx((tx) => post(tx, dep));
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect((await db.tx((tx) => balanceOf(tx, acct.user("u1")))).balance).toBe(tokens(1000));
  });

  it("rejects unbalanced entries", async () => {
    await expect(db.tx((tx) => post(tx, { idem: "bad", kind: "x", postings: [{ account: acct.hq, amount: 5n }, { account: acct.team, amount: -4n }] }))).rejects.toThrow(LedgerError);
  });

  it("cannot overdraw; failed tx leaves no trace", async () => {
    await expect(db.tx((tx) => post(tx, { idem: "over", kind: "x", postings: transfer(acct.user("u1"), acct.hq, tokens(1001)) }))).rejects.toMatchObject({ code: "insufficient_funds" });
    const j = await db.query(`SELECT 1 FROM journal WHERE idem = 'over'`);
    expect(j.rows.length).toBe(0);
  });

  it("holds reduce available funds and block double-spend", async () => {
    await db.tx((tx) => placeHold(tx, { id: "h1", account: acct.user("u1"), amount: tokens(900), reason: "withdrawal" }));
    const b = await db.tx((tx) => balanceOf(tx, acct.user("u1")));
    expect(b.available).toBe(tokens(100));
    await expect(db.tx((tx) => post(tx, { idem: "spend", kind: "x", postings: transfer(acct.user("u1"), acct.hq, tokens(200)) }))).rejects.toMatchObject({ code: "insufficient_funds" });
    await expect(db.tx((tx) => placeHold(tx, { id: "h2", account: acct.user("u1"), amount: tokens(200), reason: "x" }))).rejects.toMatchObject({ code: "insufficient_funds" });
    // Capture: withdrawal settles onchain.
    await db.tx((tx) => captureHold(tx, "h1", { idem: "wd:h1", kind: "withdrawal", postings: transfer(acct.user("u1"), acct.chain, tokens(900)) }));
    const after = await db.tx((tx) => balanceOf(tx, acct.user("u1")));
    expect(after).toEqual({ balance: tokens(100), held: 0n, available: tokens(100) });
    await expect(db.tx((tx) => captureHold(tx, "h1", { idem: "wd:h1b", kind: "withdrawal", postings: [] }))).rejects.toMatchObject({ code: "hold_state" });
    await db.tx((tx) => placeHold(tx, { id: "h3", account: acct.user("u1"), amount: tokens(50), reason: "x" }));
    await db.tx((tx) => releaseHold(tx, "h3"));
    expect((await db.tx((tx) => balanceOf(tx, acct.user("u1")))).available).toBe(tokens(100));
  });

  it("concurrent spends never overdraw", async () => {
    await db.tx((tx) => post(tx, { idem: "dep:p1", kind: "deposit", postings: transfer(acct.chain, acct.pet("p1"), tokens(10)) }));
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, (_, i) => db.tx((tx) => post(tx, { idem: `food:${i}`, kind: "food", postings: transfer(acct.pet("p1"), acct.hq, tokens(1)) }))),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(10);
    expect((await db.tx((tx) => balanceOf(tx, acct.pet("p1")))).balance).toBe(0n);
  });

  it("trial balance is clean", async () => {
    const t = await db.tx((tx) => trialBalance(tx));
    expect(t.sumOfBalances).toBe(0n);
    expect(t.postingsImbalance).toBe(0n);
    expect(t.journalsUnbalanced).toBe(0);
    expect(t.negativeNonExternal).toBe(0);
    expect(t.derivedMismatch).toBe(0);
    expect(t.chainLiability).toBe(tokens(1000) - tokens(900) + tokens(10));
  });
});

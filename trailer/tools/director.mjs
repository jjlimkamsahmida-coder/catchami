// Persistent director: holds the CDP connection, runs commands sent over HTTP (port 9400),
// and records the active tab with the CDP screencast.
import http from "node:http";
import { connect, startRec, shot, sleep, SITE } from "./lib.mjs";

const { browser } = await connect();
import { chromium as chr } from "playwright";
const browser2 = await chr.connectOverCDP("http://127.0.0.1:9334").catch(() => null);
const tabs = {}; // kind -> { page, cdp }
let cur = null, rec = null;

const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Mobile Safari/537.36";
async function ensureTab(kind) {
  if (tabs[kind] && !tabs[kind].page.isClosed()) return tabs[kind];
  const opts = kind === "tablet"
    ? { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_ANDROID.replace("Pixel 8", "Pixel Tablet") }
    : kind === "phone"
    ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA_ANDROID }
    : kind === "wide" ? { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 };
  const ctx = await (kind === "phone" || kind === "tablet" || !browser2 ? browser : browser2).newContext({ ...opts, ...(kind === "phone" || kind === "tablet" ? { permissions: ["camera"] } : {}) });
  // Keep a handle on the game's own socket and its latest messages (for steering and aiming).
  await ctx.addInitScript(() => {
    const Orig = window.WebSocket;
    window.__last = {}; window.__toasts = [];
    // Optional auto-player for the gathering minigames: taps the real UI (Space) at the best moment.
    window.__autoMg = false;
    window.__onRound = (round, at) => {
      if (!window.__autoMg) return;
      const p = round.params, key = (type) => window.dispatchEvent(new KeyboardEvent(type, { code: "Space", key: " ", bubbles: true }));
      if (p.kind === "pull") { const start = 900 + Math.random() * 300; setTimeout(() => key("keydown"), start); setTimeout(() => key("keyup"), start + p.looseMs * 0.97); return; }
      const ang = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
      const err = (ms) => {
        if (p.kind === "chop") { const t = (ms / p.periodMs + p.phase) % 1; const m = t < 0.5 ? t * 2 : 2 - t * 2; return Math.abs(m - p.center); }
        if (p.kind === "mine") return ang((p.startDeg + (p.degPerSec * ms) / 1000) % 360, p.zoneDeg) / 360;
        const s = ms / 1000; return Math.abs(Math.max(-1, Math.min(1, p.a1 * Math.sin(p.w1 * s + p.p1) + p.a2 * Math.sin(p.w2 * s + p.p2))));
      };
      let best = 1500, be = 9;
      for (let ms = window.__mgMin ?? 1400; ms <= 4500; ms += 5) { const e = err(ms); if (e < be) { be = e; best = ms; } }
      setTimeout(() => key("keydown"), Math.max(0, best - (performance.now() - at)));
    };
    window.WebSocket = class extends Orig {
      constructor(...a) {
        super(...a);
        if (String(a[0]).includes("/ws")) window.__ws = this;
        this.addEventListener("message", (e) => { try { const m = JSON.parse(e.data); window.__last[m.t] = m; if (m.t === "toast") window.__toasts.push(m.text); if (m.t === "mg_round") window.__onRound(m.round, performance.now()); if (m.t === "mg_result") (window.__mgResults ??= []).push(m.grade); } catch {} });
      }
    };
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  tabs[kind] = { page, cdp, kind, ctx };
  return tabs[kind];
}

const loc = (page, c) => c.sel ? page.locator(c.sel).nth(c.nth ?? 0) : page.getByText(c.text, { exact: !!c.exact }).nth(c.nth ?? 0);

async function run(c) {
  if (c.op === "tab") { cur = await ensureTab(c.kind); await cur.page.bringToFront(); return { url: cur.page.url() }; }
  const page = cur.page;
  switch (c.op) {
    case "goto": await page.goto(c.url.startsWith("http") ? c.url : SITE + c.url, { waitUntil: c.wait ?? "domcontentloaded", timeout: 60000 }); return { url: page.url() };
    case "tap": await page.touchscreen.tap(c.x, c.y); return {};
    case "token": await page.goto(SITE + "/", { waitUntil: "domcontentloaded" }); await page.evaluate((t) => localStorage.setItem("catchami.token", t), c.value); return {};
    case "click": if (c.x !== undefined) await page.mouse.click(c.x, c.y); else await loc(page, c).click({ timeout: c.timeout ?? 15000, force: c.force ?? true }); return {};
    case "hover": await page.mouse.move(c.x, c.y, { steps: c.steps ?? 1 }); return {};
    case "drag": { await page.mouse.move(c.x1, c.y1); await page.mouse.down(); await page.mouse.move(c.x2, c.y2, { steps: c.steps ?? 12 }); await page.mouse.up(); return {}; }
    case "key": await page.keyboard.press(c.key); return {};
    case "down": await page.keyboard.down(c.key); return {};
    case "up": await page.keyboard.up(c.key); return {};
    case "hold": await page.keyboard.down(c.key); await sleep(c.ms); await page.keyboard.up(c.key); return {};
    case "type": await page.keyboard.type(c.text, { delay: c.delay ?? 60 }); return {};
    case "fill": await loc(page, c).fill(c.value); return {};
    case "eval": return { value: await page.evaluate(c.js) };
    case "approach": {
      // Walk up to a (moving) merchant until in shop range.
      const t0 = Date.now();
      while (Date.now() - t0 < (c.timeout ?? 60000)) {
        const r = await page.evaluate((id) => {
          const L = window.__last, own = L.own, me = own.pets.find((p) => p.id === own.controlled) ?? own.pets[0];
          const row = L.snap.p.find((p) => p[0] === me.id), m = L.snap.m.find((x) => x.id === id);
          const d = Math.hypot(m.x - row[1], m.y - row[2]);
          if (d > 50) window.__ws.send(JSON.stringify({ t: "goto", x: m.x, y: m.y + 26 }));
          return d;
        }, c.id);
        if (r <= 50) return { d: r };
        await sleep(500);
      }
      throw new Error("could not reach merchant");
    }
    case "shop": {
      const t0 = Date.now();
      while (Date.now() - t0 < (c.timeout ?? 60000)) {
        const r = await page.evaluate((id) => {
          const L = window.__last, own = L.own, me = own.pets.find((p) => p.id === own.controlled) ?? own.pets[0];
          const row = L.snap.p.find((p) => p[0] === me.id), m = L.snap.m.find((x) => x.id === id);
          const d = Math.hypot(m.x - row[1], m.y - row[2]);
          if (d > 45) { window.__ws.send(JSON.stringify({ t: "goto", x: m.x, y: m.y + 22 })); return { d }; }
          return { d, pt: window.__w2s(m.x, m.y - 122) };
        }, c.id);
        if (r.pt) {
          await page.mouse.click(r.pt.x, r.pt.y);
          await sleep(700);
          if (await page.locator(".mshop-tabs, .mshop, .sheet").count()) return { d: r.d, opened: true };
        }
        await sleep(250);
      }
      throw new Error("shop did not open");
    }
    case "battleWatch": {
      const before = await page.evaluate(() => window.__last.br_state?.match?.id ?? null);
      const t0 = Date.now();
      let id = null;
      while (Date.now() - t0 < (c.timeout ?? 300000)) {
        id = await page.evaluate((b) => { const m = window.__last.br_state?.match; return m && m.id !== b && (m.state === "active" || m.state === "invited") ? m.id : null; }, before);
        if (id) break;
        await sleep(300);
      }
      if (!id) throw new Error("no battle started");
      await run({ op: "capStart", name: c.name ?? "battle", kbps: 14000 });
      await page.evaluate(() => {
        clearInterval(window.__autoBr);
        window.__autoBr = setInterval(() => {
          const btns = [...document.querySelectorAll(".br-btn")];
          const lets = btns.find((b) => b.textContent.includes("Let's play"));
          if (lets) { setTimeout(() => lets.click(), 1600); window.__brReadyAt = 0; return; }
          const me = document.querySelector(".br-btn.me"), them = document.querySelector(".br-btn.them");
          if (!me || me.disabled) { window.__brReadyAt = 0; return; }
          if (!window.__brReadyAt) { window.__brReadyAt = performance.now(); return; }
          if (performance.now() - window.__brReadyAt < 1500) return;
          window.__brReadyAt = 0;
          const m = window.__last.br_state?.match, r = m ? m.splashesLeft / Math.max(1, m.slotsLeft) : 0.5;
          (r <= 0.5 ? me : them).click();
        }, 200);
      });
      while (Date.now() - t0 < (c.timeout ?? 300000)) {
        const st = await page.evaluate((i) => { const m = window.__last.br_state?.match; return m?.id === i ? m.state : "gone"; }, id);
        if (st === "finished" || st === "cancelled" || st === "gone") break;
        await sleep(300);
      }
      await sleep(c.tail ?? 4500);
      const out = (await run({ op: "capStop", name: c.name ?? "battle" })).out;
      const res = await page.evaluate(() => { clearInterval(window.__autoBr); const m = window.__last.br_state?.match; return { winner: m?.winner, you: m?.you, reason: m?.reason, loot: m?.loot }; });
      return { out, ...res };
    }
    case "tapWorld": {
      const pt = await page.evaluate(([x, y]) => window.__w2s(x, y), [c.x, c.y]);
      await page.mouse.click(pt.x, pt.y); return { pt };
    }
    case "shopBtn": {
      const pt = await page.evaluate((id) => { const m = window.__last.snap.m.find((x) => x.id === id); return window.__w2s(m.x, m.y - 122); }, c.id);
      await page.mouse.click(pt.x, pt.y); return { pt };
    }
    case "send": await page.evaluate((m) => window.__ws.send(JSON.stringify(m)), c.msg); return {};
    case "state": return { value: await page.evaluate(() => {
      const L = window.__last, own = L.own, me = own?.pets?.find((p) => p.id === own.controlled) ?? own?.pets?.[0];
      const row = L.snap?.p?.find((p) => p[0] === me?.id); const pos = row && { x: row[1], y: row[2], st: row[3] };
      const near = (o) => pos ? Math.round(Math.hypot(o.x - pos.x, o.y - pos.y)) : null;
      return {
        me: me && { id: me.id, name: me.name, x: pos?.x, y: pos?.y, energy: me.energy, hunger: me.hunger, hp: me.hp, balance: me.balance, inventory: me.inventory, status: me.status, task: me.task },
        merchants: (L.snap?.m ?? []).map((m) => ({ id: m.id, name: m.name, x: Math.round(m.x), y: Math.round(m.y), d: near(m), state: m.state })),
        bandits: (L.snap?.b ?? []).slice(0, 12),
        nodes: (L.welcome?.nodes ?? []).map((n) => { const o = { x: n.tx * 32 + 16, y: n.ty * 32 + 16 }; return { id: n.id, r: n.resource, ...o, d: near(o) }; }).sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)).slice(0, 6),
        pets: (L.snap?.p ?? []).length, me_st: pos?.st,
        ticker: L.market?.ticker, toasts: window.__toasts.slice(-5),
      };
    }) };
    case "wait": await sleep(c.ms); return {};
    case "metrics": await cur.cdp.send("Emulation.setDeviceMetricsOverride", c.m); return {};
    case "cdp": return { value: await cur.cdp.send(c.method, c.params ?? {}) };
    case "waitText": await page.getByText(c.text, { exact: !!c.exact }).first().waitFor({ timeout: c.timeout ?? 30000 }); return {};
    case "text": return { value: (await page.evaluate(() => document.body.innerText)).slice(0, c.max ?? 3000) };
    case "shot": return { path: await shot(page, c.name ?? "now") };
    case "recStart": rec = await startRec(cur.cdp, c.name, { ...(cur.kind === "phone" ? { maxWidth: 1170, maxHeight: 2532 } : cur.kind === "tablet" ? { maxWidth: 2048, maxHeight: 1536 } : {}), nth: c.nth ?? 1 }); return { recording: c.name };
    case "logStart": {
      await page.evaluate(() => {
        clearInterval(window.__logIv); window.__log = []; const t0 = performance.now();
        const econ = async () => { try { const j = await (await fetch("/api/economy")).json(); window.__econ = { stock: j.ticker.hqStock, demand: Object.fromEntries(Object.entries(j.ticker.demand).map(([k, v]) => [k, v.indexBps])), hq: j.hq.balance, budget: j.today.merchantAllowance, granted: j.today.merchantGranted }; } catch {} };
        econ(); window.__econIv = setInterval(econ, 3000);
        window.__logIv = setInterval(() => {
          const L = window.__last, own = L.own; if (!own) return; const p = own.pets.find((x) => x.id === own.controlled) ?? own.pets[0];
          const row = L.snap?.p?.find((x) => x[0] === p.id);
          const m = L.merchant?.detail;
          window.__log.push({ t: +((performance.now() - t0) / 1000).toFixed(2), bal: p.balance, inv: p.carried ?? p.inventory, e: Math.round(p.energy), h: Math.round(p.hunger), hp: Math.round(p.hp), act: p.activity, st: row?.[3], wallet: own.wallet?.available, econ: window.__econ, merchant: m ? { id: L.merchant.id, cash: m.cash, room: m.capacityLeft, prices: m.prices } : null });
        }, 500);
      });
      return {};
    }
    case "logStop": {
      const log = await page.evaluate(() => { clearInterval(window.__logIv); clearInterval(window.__econIv); return window.__log; });
      const { writeFileSync: wf, mkdirSync: mk } = await import("node:fs"); mk("footage2", { recursive: true }); wf(`footage2/${c.name}.log.json`, JSON.stringify(log));
      return { rows: log.length };
    }
    case "capStart": {
      const r = await page.evaluate(async ({ fps, kbps }) => {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: fps }, preferCurrentTab: true });
        const mime = ["video/webm;codecs=h264", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m));
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: kbps * 1000 });
        const parts = []; rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
        rec.start(1000);
        window.__cap = { rec, stream, parts };
        const st = stream.getVideoTracks()[0].getSettings();
        return { mime, w: st.width, h: st.height, fps: st.frameRate };
      }, { fps: c.fps ?? 60, kbps: c.kbps ?? 16000 });
      return r;
    }
    case "capStop": {
      const size = await page.evaluate(async () => {
        const { rec, stream, parts } = window.__cap;
        await new Promise((res) => { rec.onstop = res; rec.stop(); });
        stream.getTracks().forEach((t) => t.stop());
        window.__capBlob = new Blob(parts); return window.__capBlob.size;
      });
      const { mkdirSync: mk, writeFileSync: wf, appendFileSync: af } = await import("node:fs");
      mk("footage2", { recursive: true }); const out = `footage2/${c.name}.webm`; wf(out, Buffer.alloc(0));
      const CH = 6 * 1024 * 1024;
      for (let off = 0; off < size; off += CH) {
        const b64 = await page.evaluate(async ([o, n]) => { const buf = new Uint8Array(await window.__capBlob.slice(o, o + n).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); return btoa(bin); }, [off, CH]);
        af(out, Buffer.from(b64, "base64"));
      }
      await page.evaluate(() => { window.__capBlob = null; window.__cap = null; });
      return { out, size };
    }
    case "recStop": { const out = await rec.stop(); rec = null; return { out }; }
    default: throw new Error("unknown op " + c.op);
  }
}

import { createWriteStream, mkdirSync as mkd } from "node:fs";
const uploads = {};
http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") { res.end(); return; }
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/up") {
    const name = u.searchParams.get("n"); mkd("footage2", { recursive: true });
    uploads[name] ??= createWriteStream(`footage2/${name}.webm`);
    req.on("data", (d) => uploads[name].write(d));
    req.on("end", () => { if (u.searchParams.get("last")) { uploads[name].end(); delete uploads[name]; } res.end("ok"); });
    return;
  }
  let body = ""; req.on("data", (d) => (body += d));
  req.on("end", async () => {
    try {
      const cmds = JSON.parse(body || "[]");
      const out = [];
      for (const c of Array.isArray(cmds) ? cmds : [cmds]) out.push(await run(c));
      res.end(JSON.stringify({ ok: true, out }));
    } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e.message ?? e).slice(0, 600) })); }
  });
}).listen(9400, () => console.log("director on :9400"));

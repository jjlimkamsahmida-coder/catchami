import { chromium } from "playwright";
import { mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

export const SITE = process.env.SITE ?? "https://catchami-production.up.railway.app";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9333");
  const ctx = browser.contexts()[0];
  return { browser, ctx };
}

/** Get (or open) a named tab. Viewport: desktop 1280x720 @1.5 (=1920x1080) or phone 390x844 @3. */
export async function tab(ctx, kind = "desktop") {
  let page = ctx.pages().find((p) => p.url().startsWith(SITE) && (p.__kind ?? kind) === kind && !p.isClosed());
  const pages = ctx.pages();
  const want = kind === "phone" ? 1 : 0;
  page = pages.filter((p) => !p.url().startsWith("https://testnet.nearblocks"))[want];
  if (!page) page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (kind === "phone") {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36" });
  } else {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1.5, mobile: false });
  }
  return { page, cdp };
}

/** CDP screencast recorder -> footage/<name>.mp4 (constant 30 fps). */
export async function startRec(cdp, name, { maxWidth = 1920, maxHeight = 1080, nth = 1 } = {}) {
  const dir = resolve("frames", name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = async (e) => {
    const i = frames.length;
    const f = join(dir, `${String(i).padStart(6, "0")}.jpg`);
    writeFileSync(f, Buffer.from(e.data, "base64"));
    frames.push({ f, t: e.metadata.timestamp });
    cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth, maxHeight, everyNthFrame: nth });
  const t0 = Date.now();
  return {
    async stop() {
      await cdp.send("Page.stopScreencast").catch(() => {});
      cdp.off("Page.screencastFrame", onFrame);
      // concat list with real durations, then CFR 30 fps H.264
      const lines = ["ffconcat version 1.0"];
      frames.forEach((fr, i) => {
        const d = frames[i + 1] ? frames[i + 1].t - fr.t : 1 / 30;
        lines.push(`file '${fwd(fr.f)}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
      });
      if (frames.length) lines.push(`file '${fwd(frames[frames.length - 1].f)}'`);
      const list = join(dir, "list.txt");
      writeFileSync(list, lines.join("\n"));
      mkdirSync(resolve("footage"), { recursive: true });
      const out = resolve("footage", `${name}.mp4`);
      execFileSync("npx", ["remotion", "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-r", "30", "-c:v", "libx264", "-crf", "15", "-preset", "medium", "-pix_fmt", "yuv420p", out], { stdio: "inherit", shell: true });
      console.log(`recorded ${name}: ${frames.length} frames, ${((frames.at(-1)?.t ?? 0) - (frames[0]?.t ?? 0)).toFixed(1)}s -> ${out}`);
      return out;
    },
  };
}

export async function shot(page, name) {
  mkdirSync(resolve("frames", "shots"), { recursive: true });
  const p = resolve("frames", "shots", `${name}.png`);
  await page.screenshot({ path: p });
  return p;
}

function fwd(p) { return p.split(String.fromCharCode(92)).join("/"); }

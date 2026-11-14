// Second recording browser for gameplay: NO fake devices, so tab capture records the real tab (60 fps, hardware encode).
import { resolve } from "node:path";
import { chromium } from "playwright";
const ctx = await chromium.launchPersistentContext(resolve(".chrome-profile2"), {
  channel: "chrome", headless: true, viewport: null,
  args: ["--remote-debugging-port=9334", "--window-size=1920,1080", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=no-user-gesture-required",
    "--auto-accept-this-tab-capture", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"],
});
console.log("gameplay browser ready on :9334", ctx.pages().length);
await new Promise(() => {});

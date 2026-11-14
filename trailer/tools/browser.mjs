// Launches the recording browser (kept running) with a virtual camera that plays the cat clip.
// Other scripts attach over CDP on port 9333.
import { resolve } from "node:path";
import { chromium } from "playwright";
const cam = resolve("assets/cam/cat.mjpeg");
const ctx = await chromium.launchPersistentContext(resolve(".chrome-profile"), {
  channel: process.env.CHANNEL ?? "chrome",
  headless: true,
  viewport: null,
  args: [
    "--remote-debugging-port=9333",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${cam}`,
    "--window-size=1920,1080", "--autoplay-policy=no-user-gesture-required", "--enable-gpu-rasterization", "--ignore-gpu-blocklist",
    "--hide-scrollbars", "--mute-audio",
  ],
  permissions: ["camera"],
});
console.log("recording browser ready on :9333", ctx.pages().length);
await new Promise(() => {});

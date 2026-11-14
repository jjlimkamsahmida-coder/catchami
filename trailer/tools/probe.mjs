import { connect, tab, SITE, sleep, shot } from "./lib.mjs";
const { browser, ctx } = await connect();
const r = await fetch(SITE + "/api/auth/near-auth", { method: "POST", headers: { "content-type": "application/json" }, body: '{"idToken":"x"}' }).then((x) => x.text());
console.log("near-auth route:", r.slice(0, 80));
const { page } = await tab(ctx, "phone");
await page.goto(SITE + "/", { waitUntil: "networkidle" });
await sleep(2500);
console.log(await shot(page, "probe-phone"));
await browser.close().catch(() => {});

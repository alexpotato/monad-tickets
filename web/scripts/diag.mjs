import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
let r429 = 0, rpcCalls = 0;
page.on("response", (res) => {
  if (res.url().includes("testnet-rpc.monad.xyz")) { rpcCalls++; if (res.status() === 429) r429++; }
});
await page.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "networkidle" });
await page.waitForTimeout(12000);
const body = (await page.textContent("body")).slice(0, 140);
console.log("rpc calls:", rpcCalls, "| 429s:", r429);
console.log("screen:", body.replace(/\s+/g, " ").trim());
await browser.close();

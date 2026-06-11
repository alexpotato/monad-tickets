import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
let usedRpc = new Set(), bad = 0;
page.on("response", (r) => {
  const u = r.url();
  if (u.includes("/rpc/") || u.includes("monad.xyz")) { usedRpc.add(new URL(u).host); if (r.status() >= 400) bad++; }
});
// Company is the heaviest route — the one that failed before.
await page.goto("https://alexpotato.github.io/monad-tickets/#/company", { waitUntil: "networkidle" });
await page.waitForTimeout(14000);
const body = (await page.textContent("body")).replace(/\s+/g," ");
console.log("RPC host(s) used:", [...usedRpc].join(", "));
console.log("4xx/5xx responses:", bad);
console.log("company:", /chain unreachable/.test(body) ? "❌ unreachable" : (/attendance|fan|Block Party/.test(body) ? "✅ loaded" : "?"));
await browser.close();

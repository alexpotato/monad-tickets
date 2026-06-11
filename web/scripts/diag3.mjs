import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on("console", (m) => console.log("[console]", m.type(), m.text().slice(0, 300)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));
page.on("response", (res) => {
  if (res.url().includes("testnet-rpc.monad.xyz") && res.status() !== 200)
    console.log("[rpc]", res.status());
});
await page.goto("https://alexpotato.github.io/monad-tickets/#/company", { waitUntil: "networkidle" });
await page.waitForTimeout(12000);
await browser.close();

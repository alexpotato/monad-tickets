import { chromium } from "playwright";
const browser = await chromium.launch();
for (const route of ["company", "demo", "presentation"]) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  let calls = 0, r429 = 0, maxBurst = 0, burst = 0, lastT = 0;
  page.on("response", (res) => {
    if (!res.url().includes("testnet-rpc.monad.xyz")) return;
    calls++; const now = Date.now();
    if (now - lastT < 1000) { burst++; maxBurst = Math.max(maxBurst, burst); } else burst = 1;
    lastT = now;
    if (res.status() === 429) r429++;
  });
  await page.goto(`https://alexpotato.github.io/monad-tickets/#/${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(14000);
  const body = (await page.textContent("body")).replace(/\s+/g, " ").trim().slice(0, 110);
  console.log(`[${route}] calls:${calls} 429s:${r429} maxBurst/s:${maxBurst}`);
  console.log(`         screen: ${body}`);
  await page.close();
}
await browser.close();

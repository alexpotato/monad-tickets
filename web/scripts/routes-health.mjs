import { chromium } from "playwright";
const browser = await chromium.launch();
for (const route of ["", "company", "demo"]) {
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  let unreachable = false;
  await page.goto(`https://alexpotato.github.io/monad-tickets/#/${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(16000);
  const body = (await page.textContent("body")).replace(/\s+/g, " ");
  unreachable = /chain unreachable/.test(body);
  const hasContent = /Block Party|Wallet|attendance|fan/.test(body);
  console.log(`[${route || "root"}] ${unreachable ? "❌ chain unreachable" : (hasContent ? "✅ loaded" : "? " + body.slice(0,60))}`);
  await page.close();
}
await browser.close();

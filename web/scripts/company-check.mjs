import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/#/company", { waitUntil: "networkidle" });
await page.waitForSelector("table.rostr tbody tr", { timeout: 40000 });
const rows = await page.$$eval("table.rostr tbody tr", (trs) =>
  trs.map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent.trim())),
);
console.log("✅ company roster rows:", rows.length);
for (const r of rows.slice(0, 6)) console.log("  ", r.join(" | "));
await page.screenshot({ path: "/tmp/pwa-test/company.png", fullPage: true });
await browser.close();

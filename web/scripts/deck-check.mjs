import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
// literal /presentation path should redirect into the deck
await page.goto("https://alexpotato.github.io/monad-tickets/presentation/", { waitUntil: "networkidle" });
await page.waitForSelector(".deck", { timeout: 30000 });
console.log("✅ /presentation redirects into the deck");
console.log("  slide 1:", (await page.textContent(".slide h1"))?.trim());
// arrow to the live-data slide (8th)
for (let k = 0; k < 7; k++) await page.keyboard.press("ArrowRight");
await page.waitForSelector(".deck-table tbody tr", { timeout: 40000 });
const rows = await page.$$eval(".deck-table tbody tr", trs => trs.map(tr => tr.textContent.trim().slice(0, 80)));
console.log("✅ live roster slide rows:", rows.length);
console.log("  ", rows.find(r => /reseller/.test(r)) ?? rows[0]);
await page.screenshot({ path: "/tmp/pwa-test/deck-live.png" });
// last slide
await page.keyboard.press("End"); // no-op; use arrows
for (let k = 0; k < 2; k++) await page.keyboard.press("ArrowRight");
console.log("✅ deck position:", (await page.textContent(".deck-pos")).trim());
await browser.close();

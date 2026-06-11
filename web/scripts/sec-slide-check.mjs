import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/#/presentation", { waitUntil: "networkidle" });
await page.waitForSelector(".deck", { timeout: 30000 });
for (let k = 0; k < 5; k++) await page.keyboard.press("ArrowRight"); // → slide 6
await page.waitForSelector(".twocol", { timeout: 10000 });
const h2 = (await page.textContent(".slide h2")).trim();
const cols = await page.$$eval(".twocol h4", els => els.map(e => e.textContent.trim()));
console.log("✅ slide 6 title:", h2);
console.log("✅ columns:", cols.join(" | "));
console.log("✅ position:", (await page.textContent(".deck-pos")).trim());
await page.screenshot({ path: "/tmp/pwa-test/sec-slide.png" });
await browser.close();

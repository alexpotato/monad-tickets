import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/#/presentation", { waitUntil: "networkidle" });
await page.waitForSelector(".deck", { timeout: 30000 });
for (let k = 0; k < 6; k++) await page.keyboard.press("ArrowRight"); // → slide 7
await page.waitForFunction(() => /NFC gate/.test(document.querySelector(".slide h2")?.textContent ?? ""), { timeout: 10000 });
console.log("✅ slide 7:", (await page.textContent(".slide h2")).trim());
console.log("✅ position:", (await page.textContent(".deck-pos")).trim());
await page.screenshot({ path: "/tmp/pwa-test/nfc-slide.png" });
await browser.close();

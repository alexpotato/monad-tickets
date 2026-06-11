import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/#/presentation", { waitUntil: "networkidle" });
await page.waitForSelector(".deck-qr img", { timeout: 30000 });
const src = await page.getAttribute(".deck-qr img", "src");
console.log("✅ QR rendered on title slide (data URL,", src.length, "chars)");
await page.screenshot({ path: "/tmp/pwa-test/deck-qr.png" });
await browser.close();

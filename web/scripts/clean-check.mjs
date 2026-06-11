import { chromium, devices } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "networkidle" });
await page.waitForSelector(".phone", { timeout: 30000 });
const navLinks = (await page.$$(".topbar nav a")).length;
const topbarSelects = (await page.$$(".topbar select")).length;
const personaSelects = (await page.$$(".persona select")).length;
const label = await page.textContent(".persona");
console.log("nav links:", navLinks, "| topbar selects:", topbarSelects, "| persona selects:", personaSelects);
console.log("persona row:", label.trim().slice(0, 40));
await page.screenshot({ path: "/tmp/pwa-test/clean-default.png" });
await browser.close();
if (navLinks + topbarSelects + personaSelects === 0) console.log("✅ default page is phone-only");
else { console.log("❌ extra chrome still visible"); process.exit(1); }

// Quick smoke of the hosted PWA against Monad testnet (mobile emulation).
import { chromium, devices } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
page.on("console", (m) => m.type() === "error" && console.log("[console]", m.text().slice(0, 200)));
page.on("requestfailed", (r) => console.log("[failed]", r.url().slice(0, 110), r.failure()?.errorText));
await page.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "networkidle" });
await page.waitForTimeout(8000);
console.log("--- body (first 300) ---");
console.log((await page.textContent("body")).slice(0, 300));
const seats = (await page.$$(".seat")).length;
console.log("seats rendered:", seats);
await page.screenshot({ path: "/tmp/pwa-test/live-debug.png" });
await browser.close();

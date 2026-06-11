// Verify the Get-funds button on the live hosted PWA (fresh wallet, mobile).
import { chromium, devices } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "networkidle" });
await page.waitForSelector(".seat", { timeout: 40000 });

const btn = page.getByRole("button", { name: /Get 2 MON/ });
await btn.waitFor({ timeout: 20000 });
console.log("✅ Get-funds button shown for fresh wallet");
await btn.click();
await page.waitForFunction(
  () => /sent by the demo sponsor/.test(document.querySelector(".msg.ok")?.textContent ?? ""),
  { timeout: 90000 },
);
console.log("✅ sponsor transfer confirmed:", (await page.textContent(".msg.ok")).trim());
await page.waitForFunction(
  () => (document.querySelector(".balance")?.textContent ?? "").startsWith("2.00"),
  { timeout: 60000 },
);
console.log("✅ balance shows", (await page.textContent(".balance")).trim());
await page.screenshot({ path: "/tmp/pwa-test/getfunds.png" });
await browser.close();
console.log("GET-FUNDS CHECK PASSED");

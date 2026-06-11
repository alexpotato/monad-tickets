import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/#/gate", { waitUntil: "networkidle" });
await page.waitForSelector(".gatecode", { timeout: 30000 });
const t0 = Date.now();
await page.getByRole("button", { name: /Rotate venue code/i }).click();
await page.waitForFunction(
  () => /[A-Z]+-\d{4}/.test(document.querySelector(".gatecode .code")?.textContent ?? ""),
  { timeout: 30000 },
);
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`✅ code visible ${secs}s after pressing rotate:`, (await page.textContent(".gatecode .code")).trim());
await browser.close();

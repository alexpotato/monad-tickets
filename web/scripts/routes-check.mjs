import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const URL = "https://alexpotato.github.io/monad-tickets/";

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForSelector(".phone", { timeout: 30000 });
const nav = await page.$$(".topbar nav a");
console.log("✅ / → wallet app (phone frame), operator links hidden:", nav.length === 0);

await page.goto(`${URL}#/admin`); await page.waitForSelector(".seatgrid", { timeout: 30000 });
console.log("✅ #/admin → organizer dashboard:", /Seat map/.test(await page.textContent("body")));

await page.goto(`${URL}#/gate`); await page.waitForSelector(".gatecode", { timeout: 30000 });
console.log("✅ #/gate → venue gate");

await page.goto(`${URL}#/demo`); await page.waitForSelector(".threepane", { timeout: 30000 });
console.log("✅ #/demo → three-pane control room");
await browser.close();

import { chromium, devices } from "playwright";
const b = await chromium.launch();
const p = await (await b.newContext({ ...devices["iPhone 13"] })).newPage();
await p.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "networkidle" });
await p.waitForSelector(".seat", { timeout: 40000 });
const body = (await p.textContent("body")).replace(/\s+/g," ");
console.log(/Category Labs Hackathon/.test(body) ? "✅ event name: Category Labs Hackathon" : "❌ name not found");
console.log(`seats: ${(await p.$$(".seat")).length}, sold: ${(await p.$$(".seat.sold,.seat.used")).length}`);
await b.close();

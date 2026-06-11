import { chromium, devices } from "playwright";
const browser = await chromium.launch();
// attendee (root): all seats should be buyable
const p1 = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
await p1.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "networkidle" });
await p1.waitForSelector(".seat", { timeout: 40000 });
const seats = await p1.$$(".seat");
const sold = await p1.$$(".seat.sold, .seat.used");
console.log(`attendee: ${seats.length} seats, ${sold.length} sold/used (want 0 sold)`);
// company roster should be empty
const p2 = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
await p2.goto("https://alexpotato.github.io/monad-tickets/#/company", { waitUntil: "networkidle" });
await p2.waitForTimeout(8000);
const rows = await p2.$$("table.rostr tbody tr");
const body = (await p2.textContent("body")).replace(/\s+/g," ");
console.log(`company: ${rows.length} roster rows; ${/No buyers or attendees yet/.test(body) ? "shows empty-state ✅" : "(has data)"}`);
await browser.close();

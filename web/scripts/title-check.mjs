import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
for (const [route, want] of [["","🎫"],["admin","🛠"],["gate","🚪"],["company","📊"],["demo","🖥"],["presentation","📽"]]) {
  await page.goto(`https://alexpotato.github.io/monad-tickets/#/${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  const t = await page.title();
  console.log(`${t.includes(want) ? "✅" : "❌"} #/${route || ""} → ${t}`);
}
await browser.close();

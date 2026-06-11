import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "domcontentloaded" });
const out = await page.evaluate(async () => {
  const url = "https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL";
  const r = {};
  // (a) "simple" POST (text/plain) — avoids the CORS preflight entirely
  try {
    const x = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
    });
    r.simplePost = x.status + " " + (await x.text()).slice(0, 60);
  } catch (e) {
    r.simplePost = "THREW " + String(e).slice(0, 90);
  }
  // (b) no-cors GET — just see if the socket connects at all
  try {
    await fetch(url, { method: "GET", mode: "no-cors" });
    r.noCorsGet = "connected (opaque)";
  } catch (e) {
    r.noCorsGet = "THREW " + String(e).slice(0, 90);
  }
  return r;
});
console.log("simple POST (no preflight):", out.simplePost);
console.log("no-cors GET (socket only): ", out.noCorsGet);
await browser.close();

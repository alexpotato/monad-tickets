import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto("https://alexpotato.github.io/monad-tickets/", { waitUntil: "domcontentloaded" });
// fetch the RPC straight from the page's browser context (real CORS + egress)
const out = await page.evaluate(async () => {
  const probe = async (url) => {
    try {
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }) });
      return `${r.status} ${JSON.stringify(await r.json())}`;
    } catch (e) { return "THREW: " + String(e).slice(0, 120); }
  };
  return {
    dedicated: await probe("https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL"),
    public: await probe("https://testnet-rpc.monad.xyz"),
  };
});
console.log("dedicated:", out.dedicated);
console.log("public:   ", out.public);
await browser.close();

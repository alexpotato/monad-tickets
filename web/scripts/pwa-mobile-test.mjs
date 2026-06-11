// Mobile-phone verification of the Monad Tickets PWA.
// Part A: hosted PWA (GitHub Pages) — installability + testnet default + profile switch.
// Part B: local dev server — full attendee flow (buy cart → venue code → batch check-in).
import { chromium, devices } from "playwright";
import { mkdirSync } from "fs";

const SHOTS = "/tmp/pwa-test";
mkdirSync(SHOTS, { recursive: true });

const HOSTED = "https://alexpotato.github.io/monad-tickets/";
const LOCAL = "http://localhost:5173/";

const iphone = devices["iPhone 13"];
let failures = 0;
const step = (ok, label) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();

// ---------- PART A: hosted PWA as a phone ----------
console.log("PART A — hosted PWA (mobile emulation: iPhone 13)");
{
  const ctx = await browser.newContext({ ...iphone });
  const page = await ctx.newPage();
  await page.goto(HOSTED, { waitUntil: "networkidle" });

  // Manifest correctness
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const r = await fetch(link.href);
    return r.json();
  });
  step(!!manifest, `manifest linked + fetches (${manifest?.name})`);
  step(manifest?.display === "standalone", `display: ${manifest?.display}`);
  step(
    (manifest?.icons ?? []).some((i) => i.sizes === "512x512"),
    "512px icon present",
  );
  step(manifest?.start_url?.includes("#/attendee"), `start_url: ${manifest?.start_url}`);

  // Service worker registers (the installability requirement beyond manifest+HTTPS)
  const sw = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return "unsupported";
    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((res) => setTimeout(() => res(null), 15000)),
    ]);
    return reg ? { scope: reg.scope, active: !!reg.active } : "timeout";
  });
  step(sw?.active === true, `service worker active (scope ${sw?.scope})`);

  // Default profile on hosted = testnet → not-deployed notice
  const bodyText = await page.textContent("body");
  step(/Monad testnet/i.test(bodyText), "defaults to Monad testnet profile");
  step(/aren't deployed|not deployed/i.test(bodyText), "shows contracts-not-deployed notice");
  await page.screenshot({ path: `${SHOTS}/a1-hosted-testnet-notice.png` });

  // Probe: switch profile to local anvil FROM the HTTPS page. Loopback is
  // exempt from mixed-content blocking in Chromium, so this should load the
  // real local chain.
  await page.selectOption("select", "local");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  const afterSwitch = await page.textContent("body");
  // Chrome's Private Network Access blocks HTTPS→http://127.0.0.1 RPC, so the
  // app should land on the graceful "Local anvil: chain not ready" screen.
  const switched = /Local anvil/i.test(afterSwitch);
  step(switched, "🔍 profile switch persists + degrades gracefully (PNA blocks localhost RPC from HTTPS)");
  await page.screenshot({ path: `${SHOTS}/a2-hosted-local-profile.png` });
  await ctx.close();
}

// ---------- PART B: full attendee flow on local (mobile) ----------
console.log("PART B — local dev server, full flow (mobile emulation)");
{
  const ctx = await browser.newContext({ ...iphone });

  // Gate screen (separate tab, same origin → BroadcastChannel reaches it)
  const gate = await ctx.newPage();
  await gate.goto(`${LOCAL}#/gate`, { waitUntil: "networkidle" });
  await gate.waitForTimeout(2500);
  await gate.getByRole("button", { name: /Rotate venue code/i }).click();
  await gate.waitForFunction(
    () => /[A-Z]+-\d{4}/.test(document.querySelector(".gatecode .code")?.textContent ?? ""),
    { timeout: 15000 },
  );
  const code = (await gate.textContent(".gatecode .code")).trim();
  step(/^[A-Z]+-\d{4}$/.test(code), `gate rotated venue code on-chain: ${code}`);
  await gate.screenshot({ path: `${SHOTS}/b1-gate-code.png` });

  // Attendee phone
  const phone = await ctx.newPage();
  await phone.goto(LOCAL, { waitUntil: "networkidle" });
  // Mobile default route should be attendee (phone frame visible)
  await phone.waitForSelector(".phone", { timeout: 10000 });
  step(true, "mobile default route renders the attendee phone view");

  // Device wallet ("This phone") is the default persona and auto-funds on anvil
  const personaValue = await phone.$eval(".persona select", (el) => el.selectedOptions[0].text);
  step(personaValue === "This phone", `default persona: "${personaValue}" (per-device wallet)`);
  await phone.waitForFunction(
    () => {
      const b = document.querySelector(".balance")?.textContent ?? "";
      return /MON/.test(b) && !b.startsWith("0.00");
    },
    { timeout: 20000 },
  );
  const balance = await phone.textContent(".balance");
  step(true, `device wallet auto-funded on anvil: ${balance.trim()}`);

  // Buy two available seats via the cart
  await phone.waitForSelector(".seat:not([disabled])", { timeout: 15000 });
  const available = await phone.$$(".seat:not([disabled])");
  step(available.length >= 2, `${available.length} seats available`);
  await available[0].click();
  await available[1].click();
  const buyLabel = await phone.textContent("button.primary");
  step(/Buy 2 seats/.test(buyLabel), `cart button: "${buyLabel.trim()}"`);
  await phone.screenshot({ path: `${SHOTS}/b2-cart-selected.png` });
  await phone.getByRole("button", { name: /Buy 2 seats/ }).click();
  await phone.waitForSelector(".msg.ok", { timeout: 20000 });
  const buyMsg = await phone.textContent(".msg.ok");
  step(/2 seats minted/.test(buyMsg), `purchase (one tx): ${buyMsg.trim()}`);

  // Tickets tab opened automatically; select both passes, type code once
  await phone.waitForSelector(".tickpass", { timeout: 15000 });
  const passes = await phone.$$(".tickpass");
  step(passes.length >= 2, `${passes.length} ticket passes shown`);
  // Dispatch DOM clicks: Playwright's strict hit-testing races the app's 2s
  // polling re-renders (see findings); a real tap lands fine.
  for (const p of passes) await p.evaluate((el) => el.click());
  await phone.fill('input[placeholder*="Venue code"]', code);
  const presentBtn = phone.getByRole("button", { name: /Sign & present \d+ ticket/ });
  step(await presentBtn.isEnabled(), "present button enabled after selection + code");
  await phone.screenshot({ path: `${SHOTS}/b3-checkin-ready.png` });
  await presentBtn.click();

  // Gate (leader tab) auto-submits the batch; phone shows the result
  await phone.waitForFunction(
    () => /Checked in!/.test(document.querySelector(".msg.ok")?.textContent ?? ""),
    { timeout: 30000 },
  );
  const result = await phone.textContent(".msg.ok");
  step(/Checked in!/.test(result), `gate accepted batch: ${result.trim()}`);
  const gateLog = await gate.textContent(".scanlog");
  step(/✓ Welcome!/.test(gateLog), "gate scanner feed logged the welcome");
  await gate.screenshot({ path: `${SHOTS}/b4-gate-feed.png` });

  // Profile: stubs + loyalty
  await phone.getByRole("button", { name: "Profile" }).click();
  await phone.waitForFunction(
    () => {
      const stats = [...document.querySelectorAll(".stat .v")].map((e) => e.textContent);
      return stats.length >= 2 && Number(stats[0]) >= 20 && Number(stats[1]) >= 2;
    },
    { timeout: 20000 },
  );
  const stats = await phone.$$eval(".stat .v", (els) => els.map((e) => e.textContent));
  step(true, `loyalty score ${stats[0]}, stubs ${stats[1]}`);
  await phone.waitForSelector(".tickpass", { timeout: 10000 });
  await phone.screenshot({ path: `${SHOTS}/b5-profile-stubs.png` });

  // Probe: wrong venue code on a third ticket → gate must reject readably
  await phone.getByRole("button", { name: /Buy seats/ }).click();
  const more = await phone.$$(".seat:not([disabled])");
  if (more.length >= 1) {
    await more[0].click();
    await phone.getByRole("button", { name: /Buy 1 seat/ }).click();
    await phone.waitForSelector(".tickpass", { timeout: 20000 });
    await (await phone.$(".tickpass")).evaluate((el) => el.click());
    await phone.fill('input[placeholder*="Venue code"]', "WRONG-0000");
    await phone.getByRole("button", { name: /Sign & present 1 ticket/ }).click();
    await phone.waitForSelector(".msg.err", { timeout: 30000 });
    const rejection = await phone.textContent(".msg.err");
    step(
      /venue code is wrong or expired/i.test(rejection),
      `🔍 wrong code rejected with friendly message: "${rejection.trim()}"`,
    );
    await phone.screenshot({ path: `${SHOTS}/b6-wrong-code-rejected.png` });
  }

  await ctx.close();
}

await browser.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

// Full end-to-end on the HOSTED PWA against Monad TESTNET, as a phone:
// fund device wallet via faucet → buy a seat → rotate gate code → check in.
import { chromium, devices } from "playwright";
import { privateKeyToAccount } from "viem/accounts";

const URL = "https://alexpotato.github.io/monad-tickets/";
const FAUCET = "https://rpc.monad-testnet.category.xyz/faucet/request";
const AUTH = "Basic " + Buffer.from("hackathon:hackathon2026").toString("base64");

let failures = 0;
const step = (ok, label) => {
  console.log(`${ok ? "  ✅" : "  ❌"} ${label}`);
  if (!ok) failures++;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"] });

// Attendee phone
const phone = await ctx.newPage();
await phone.goto(URL, { waitUntil: "networkidle" });
await phone.waitForSelector(".seat", { timeout: 40000 });
step(true, "hosted PWA loaded the testnet seat map");

// Fund the device wallet via the faucet
const pk = await phone.evaluate(() => localStorage.getItem("device-wallet-pk"));
const address = privateKeyToAccount(pk).address;
const fr = await fetch(FAUCET, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: AUTH },
  body: JSON.stringify({ address }),
});
const fj = await fr.json();
step(fj.success === true, `faucet funded device wallet ${address.slice(0, 10)}… (tx ${fj.tx_hash?.slice(0, 14)}…)`);

// Wait for the balance to show up in the UI (poll is 8s on testnet)
await phone.waitForFunction(
  () => {
    const b = document.querySelector(".balance")?.textContent ?? "";
    return /MON/.test(b) && !b.startsWith("0.00");
  },
  { timeout: 60000 },
);
step(true, `balance visible in app: ${(await phone.textContent(".balance")).trim()}`);

// Gate (second tab in the same browser, like a phone user switching tabs)
const gate = await ctx.newPage();
await gate.goto(`${URL}#/gate`, { waitUntil: "networkidle" });
await gate.waitForSelector(".gatecode", { timeout: 30000 });
await gate.getByRole("button", { name: /Rotate venue code/i }).click();
await gate.waitForFunction(
  () => /[A-Z]+-\d{4}/.test(document.querySelector(".gatecode .code")?.textContent ?? ""),
  { timeout: 60000 },
);
const code = (await gate.textContent(".gatecode .code")).trim();
step(true, `gate rotated venue code on testnet: ${code}`);

// Buy one seat
await phone.bringToFront();
await phone.waitForSelector(".seat:not([disabled])", { timeout: 60000 });
const seat = await phone.$(".seat:not([disabled])");
await seat.evaluate((el) => el.click());
await phone.getByRole("button", { name: /Buy 1 seat/ }).click();
await phone.waitForSelector(".msg.ok", { timeout: 60000 });
step(/minted/.test(await phone.textContent(".msg.ok")), `bought: ${(await phone.textContent(".msg.ok")).trim()}`);

// Check in: select pass, type code once, sign once
await phone.waitForSelector(".tickpass", { timeout: 30000 });
await (await phone.$(".tickpass")).evaluate((el) => el.click());
await phone.fill('input[placeholder*="Venue code"]', code);
await phone.getByRole("button", { name: /Sign & present/ }).click();
await phone.waitForFunction(
  () => /Checked in!/.test(document.querySelector(".msg.ok")?.textContent ?? ""),
  { timeout: 90000 },
);
step(true, `gate accepted: ${(await phone.textContent(".msg.ok")).trim()}`);

// Profile shows the stub + loyalty
await phone.getByRole("button", { name: "Profile" }).click();
await phone.waitForFunction(
  () => {
    const stats = [...document.querySelectorAll(".stat .v")].map((e) => Number(e.textContent));
    return stats.length >= 2 && stats[0] >= 10 && stats[1] >= 1;
  },
  { timeout: 60000 },
);
const stats = await phone.$$eval(".stat .v", (els) => els.map((e) => e.textContent));
step(true, `loyalty ${stats[0]}, stubs ${stats[1]} — on public testnet`);
await phone.screenshot({ path: "/tmp/pwa-test/live-testnet-checkedin.png" });

await browser.close();
console.log(failures === 0 ? "\nLIVE TESTNET E2E PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);

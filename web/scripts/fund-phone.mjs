// Fund newly-created phone wallets on Monad testnet.
//
// Tops up a distributor wallet from the team faucet when needed, then sends a
// small amount to each phone address — one faucet draw (100 MON) funds ~50
// phones at the default 2 MON each.
//
// Usage:
//   node scripts/fund-phone.mjs 0xPHONE [0xPHONE2 ...] [--amount 2]
//   npm run fund -- 0xPHONE
//
// Reads from the repo-root .env (gitignored):
//   TESTNET_DEPLOYER_PK  distributor wallet key
//   FAUCET_URL/USER/PASS team faucet endpoint + basic auth
import { createPublicClient, createWalletClient, http, parseEther, formatEther, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fileURLToPath } from "url";

process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
const { TESTNET_DEPLOYER_PK, FAUCET_URL, FAUCET_USER, FAUCET_PASS } = process.env;
if (!TESTNET_DEPLOYER_PK || !FAUCET_URL) {
  console.error("Missing TESTNET_DEPLOYER_PK / FAUCET_URL in .env — see TESTNET.md");
  process.exit(1);
}

const args = process.argv.slice(2);
const amountIdx = args.indexOf("--amount");
const amount = parseEther(amountIdx >= 0 ? args[amountIdx + 1] : "2");
const targets = args.filter((a, i) => i !== amountIdx && i !== amountIdx + 1);

if (targets.length === 0 || !targets.every(isAddress)) {
  console.error("Usage: node scripts/fund-phone.mjs 0xPHONE [0xPHONE2 ...] [--amount MON]");
  console.error("(The phone address is in the app's faucet banner — tap to copy.)");
  process.exit(1);
}

const RPC = "https://testnet-rpc.monad.xyz";
const chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
};
const pub = createPublicClient({ chain, transport: http(RPC) });
const funder = privateKeyToAccount(TESTNET_DEPLOYER_PK);
const wallet = createWalletClient({ account: funder, chain, transport: http(RPC) });

async function faucetTopUp(address) {
  const r = await fetch(FAUCET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${FAUCET_USER}:${FAUCET_PASS}`).toString("base64"),
    },
    body: JSON.stringify({ address }),
  });
  const j = await r.json();
  if (!j.success) throw new Error(`faucet refused: ${JSON.stringify(j)}`);
  console.log(`  faucet → distributor: tx ${j.tx_hash.slice(0, 18)}…`);
}

// Top up the distributor if it can't cover all sends (+ gas headroom).
const need = amount * BigInt(targets.length) + parseEther("0.1");
let balance = await pub.getBalance({ address: funder.address });
console.log(`distributor ${funder.address}: ${formatEther(balance)} MON`);
if (balance < need) {
  console.log("  low — drawing from faucet…");
  await faucetTopUp(funder.address);
  for (let i = 0; i < 20 && balance < need; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    balance = await pub.getBalance({ address: funder.address });
  }
  if (balance < need) throw new Error("faucet draw didn't land in time");
  console.log(`  distributor now: ${formatEther(balance)} MON`);
}

for (const to of targets) {
  const before = await pub.getBalance({ address: to });
  const hash = await wallet.sendTransaction({ to, value: amount });
  await pub.waitForTransactionReceipt({ hash });
  const after = await pub.getBalance({ address: to });
  console.log(
    `✓ ${to}: ${formatEther(before)} → ${formatEther(after)} MON  (tx ${hash.slice(0, 18)}…)`,
  );
}
console.log(`\nFunded ${targets.length} phone wallet(s) with ${formatEther(amount)} MON each.`);

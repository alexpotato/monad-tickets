// Concurrency / on-sale stress test against the LIVE testnet contract.
// Scenario 1: N buyers hit DIFFERENT seats at the same instant — all succeed.
// Scenario 2: M buyers race for the SAME seat — exactly one wins, rest revert
//             cleanly with SeatUnavailable (no double-mint, no lost funds).
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther,
  keccak256, toBytes, defineChain,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const RPC = "https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL";
const chain = defineChain({ id: 10143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });

const SPONSOR = "0x8621db44fe63c1e243c07da91197e5a5270b6d4359a8aa65c7c68bbd5c2ad8bc";
const COLLECTION = "0x5EEb2d77d61F667a9bf08dFD9f4eb9349274F8DE";
const PRICE = parseEther("0.01");
const abi = parseAbi([
  "function buySeat(string) payable returns (uint256)",
  "function seatListing(bytes32) view returns (uint16,uint256,bool,uint256)",
  "function ownerOf(uint256) view returns (address)",
]);

const w = (pk) => createWalletClient({ account: privateKeyToAccount(pk), chain, transport: http(RPC) });
const sponsor = w(SPONSOR);
const seatOwner = async (label) => {
  const [, , , tid] = await pub.readContract({ address: COLLECTION, abi, functionName: "seatListing", args: [keccak256(toBytes(label))] });
  if (tid === 0n) return null;
  return pub.readContract({ address: COLLECTION, abi, functionName: "ownerOf", args: [tid] });
};

// --- make N funded buyer wallets ---
const N = 6;
const buyers = Array.from({ length: N }, () => privateKeyToAccount(generatePrivateKey()));
console.log(`Funding ${N} fresh buyer wallets from the sponsor…`);
let nonce = await pub.getTransactionCount({ address: sponsor.account.address });
const fundHashes = [];
for (const b of buyers) {
  // 0.5 MON: covers the 0.01 seat + Monad's high gas-limit reserve at ~100 gwei.
  fundHashes.push(await sponsor.sendTransaction({ to: b.address, value: parseEther("0.5"), nonce: nonce++ }));
}
await Promise.all(fundHashes.map((h) => pub.waitForTransactionReceipt({ hash: h })));
console.log("  funded.\n");

const buy = async (acct, label) => {
  const wc = createWalletClient({ account: acct, chain, transport: http(RPC) });
  const t0 = Date.now();
  try {
    const hash = await wc.writeContract({ address: COLLECTION, abi, functionName: "buySeat", args: [label], value: PRICE });
    await pub.waitForTransactionReceipt({ hash });
    return { ok: true, who: acct.address, label, ms: Date.now() - t0 };
  } catch (e) {
    const m = String(e.message).match(/SeatUnavailable|WrongPayment|reverted/)?.[0] ?? "error";
    return { ok: false, who: acct.address, label, why: m, ms: Date.now() - t0 };
  }
};

// === Scenario 1: different seats, all at once ===
console.log("=== Scenario 1: 6 buyers → 6 DIFFERENT seats, fired simultaneously ===");
const diffSeats = ["T-1", "T-2", "T-3", "T-4", "T-5", "T-6"];
const r1 = await Promise.all(buyers.map((b, i) => buy(b, diffSeats[i])));
for (const r of r1) console.log(`  ${r.ok ? "✅ bought" : "❌ " + r.why} ${r.label} by ${r.who.slice(0, 10)}… (${r.ms}ms)`);
console.log(`  → ${r1.filter((r) => r.ok).length}/${N} succeeded\n`);

// === Scenario 2: same seat, everyone races ===
console.log("=== Scenario 2: 6 buyers → ALL race for the SAME seat T-8 ===");
const r2 = await Promise.all(buyers.map((b) => buy(b, "T-8")));
const winners = r2.filter((r) => r.ok);
for (const r of r2) console.log(`  ${r.ok ? "✅ WON" : "⛔ lost (" + r.why + ")"} by ${r.who.slice(0, 10)}… (${r.ms}ms)`);
const finalOwner = await seatOwner("T-8");
console.log(`\n  winners: ${winners.length} (must be exactly 1)`);
console.log(`  on-chain owner of T-8: ${finalOwner?.slice(0, 10)}…`);
const ownerMatchesWinner = winners.length === 1 && finalOwner?.toLowerCase() === winners[0].who.toLowerCase();

// === Verdict ===
const pass1 = r1.every((r) => r.ok);
const pass2 = winners.length === 1 && ownerMatchesWinner && r2.filter((r) => !r.ok).every((r) => r.why === "SeatUnavailable");
console.log(`\nScenario 1 (no collisions): ${pass1 ? "PASS" : "FAIL"}`);
console.log(`Scenario 2 (same-seat race): ${pass2 ? "PASS — exactly one mint, losers reverted SeatUnavailable, owner = winner" : "FAIL"}`);
process.exit(pass1 && pass2 ? 0 : 1);

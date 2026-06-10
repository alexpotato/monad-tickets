// End-to-end exercise of the demo flow using the same calls the UI makes.
// Prereqs: anvil running + contracts/script/Demo.s.sol broadcast.
//   node scripts/e2e.mjs
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toBytes,
  encodeAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

const RPC = "http://127.0.0.1:8545";
const FACTORY = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";

const GATE_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const AVA_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const wallet = (pk) => {
  const account = privateKeyToAccount(pk);
  return { account, client: createWalletClient({ account, chain: foundry, transport: http(RPC) }) };
};

const factoryAbi = parseAbi(["function events(uint256) view returns (address)"]);
const collectionAbi = parseAbi([
  "function organizer() view returns (address)",
  "function loyalty() view returns (address)",
  "function stub() view returns (address)",
  "function allSeats() view returns (string[])",
  "function seatListing(bytes32) view returns (uint16, uint256, bool, uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function buySeat(string) payable returns (uint256)",
  "function checkInNonce(address) view returns (uint256)",
  "function setGateCode(bytes32)",
  "function checkIn(uint256, string, bytes)",
]);
const loyaltyAbi = parseAbi(["function scoreOf(address) view returns (int256)"]);
const stubAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const assert = (cond, label) => {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`  ok: ${label}`);
};

const collection = await pub.readContract({
  address: FACTORY, abi: factoryAbi, functionName: "events", args: [0n],
});
const read = (functionName, args = []) =>
  pub.readContract({ address: collection, abi: collectionAbi, functionName, args });

const [organizer, loyaltyAddr, stubAddr, seats] = await Promise.all([
  read("organizer"), read("loyalty"), read("stub"), read("allSeats"),
]);
console.log(`collection ${collection}, ${seats.length} seats`);

// 1. Ava buys the first available seat (same call as the UI's Buy button).
const ava = wallet(AVA_PK);
let target = null;
for (const label of seats) {
  const [, price, , tokenId] = await read("seatListing", [keccak256(toBytes(label))]);
  if (tokenId === 0n) { target = { label, price }; break; }
}
assert(target, "found an available seat");

let hash = await ava.client.writeContract({
  address: collection, abi: collectionAbi, functionName: "buySeat",
  args: [target.label], value: target.price,
});
await pub.waitForTransactionReceipt({ hash });
const [, , , tokenId] = await read("seatListing", [keccak256(toBytes(target.label))]);
assert(tokenId !== 0n, `seat ${target.label} sold → token #${tokenId}`);
assert((await read("ownerOf", [tokenId])) === ava.account.address, "Ava owns the ticket");

// 2. Gate rotates the venue code (hash on-chain, plaintext on screens).
const gate = wallet(GATE_PK);
const CODE = "MOSH-4242";
hash = await gate.client.writeContract({
  address: collection, abi: collectionAbi, functionName: "setGateCode",
  args: [keccak256(toBytes(CODE))],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`  ok: venue code committed (${CODE})`);

// 3. Ava types the code and signs — exactly what the phone sim does.
const nonce = await read("checkInNonce", [ava.account.address]);
const digest = keccak256(
  encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
    [collection, BigInt(foundry.id), tokenId, nonce, keccak256(toBytes(CODE))],
  ),
);
const sig = await ava.account.signMessage({ message: { raw: digest } });

// 3a. A wrong typed code must be rejected at the gate.
const badDigest = keccak256(
  encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
    [collection, BigInt(foundry.id), tokenId, nonce, keccak256(toBytes("WRONG-0000"))],
  ),
);
const badSig = await ava.account.signMessage({ message: { raw: badDigest } });
let rejected = false;
try {
  await gate.client.writeContract({
    address: collection, abi: collectionAbi, functionName: "checkIn",
    args: [tokenId, "WRONG-0000", badSig],
  });
} catch {
  rejected = true;
}
assert(rejected, "wrong venue code rejected");

// 4. Gate submits the valid check-in and pays gas (free for Ava).
const avaBalanceBefore = await pub.getBalance({ address: ava.account.address });
hash = await gate.client.writeContract({
  address: collection, abi: collectionAbi, functionName: "checkIn",
  args: [tokenId, CODE, sig],
});
await pub.waitForTransactionReceipt({ hash });

// 5. Outcomes: ticket returned, stub minted, loyalty credited, Ava paid nothing.
assert((await read("ownerOf", [tokenId])) === organizer, "ticket returned to event wallet");
const stubs = await pub.readContract({
  address: stubAddr, abi: stubAbi, functionName: "balanceOf", args: [ava.account.address],
});
assert(stubs >= 1n, `souvenir stub minted (balance ${stubs})`);
const score = await pub.readContract({
  address: loyaltyAddr, abi: loyaltyAbi, functionName: "scoreOf", args: [ava.account.address],
});
assert(score >= 10n, `loyalty credited (score ${score})`);
const avaBalanceAfter = await pub.getBalance({ address: ava.account.address });
assert(avaBalanceAfter === avaBalanceBefore, "check-in cost Ava zero gas");

console.log("\nE2E PASSED — buy → code → sign → gate check-in → stub + loyalty");

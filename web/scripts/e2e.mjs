// End-to-end exercise of the demo flow using the same calls the UI makes,
// including the batch paths (multi-seat buy, one-signature batch check-in).
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
  encodePacked,
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
  "function buySeats(string[]) payable returns (uint256[])",
  "function checkInNonce(address) view returns (uint256)",
  "function setGateCode(bytes32)",
  "function checkInBatch(uint256[], string, bytes)",
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

const ava = wallet(AVA_PK);
const gate = wallet(GATE_PK);

const scoreBefore = await pub.readContract({
  address: loyaltyAddr, abi: loyaltyAbi, functionName: "scoreOf", args: [ava.account.address],
});
const stubsBefore = await pub.readContract({
  address: stubAddr, abi: stubAbi, functionName: "balanceOf", args: [ava.account.address],
});

// 1. Ava buys TWO available seats in one transaction (the UI's cart flow).
const picks = [];
let total = 0n;
for (const label of seats) {
  const [, price, , tokenId] = await read("seatListing", [keccak256(toBytes(label))]);
  if (tokenId === 0n) {
    picks.push(label);
    total += price;
    if (picks.length === 2) break;
  }
}
assert(picks.length === 2, `found two available seats (${picks.join(", ")})`);

let hash = await ava.client.writeContract({
  address: collection, abi: collectionAbi, functionName: "buySeats",
  args: [picks], value: total,
});
await pub.waitForTransactionReceipt({ hash });

const ids = [];
for (const label of picks) {
  const [, , , tokenId] = await read("seatListing", [keccak256(toBytes(label))]);
  assert(tokenId !== 0n, `seat ${label} sold → token #${tokenId}`);
  assert((await read("ownerOf", [tokenId])) === ava.account.address, `Ava owns token #${tokenId}`);
  ids.push(tokenId);
}

// 2. Gate rotates the venue code (hash on-chain, plaintext on screens).
const CODE = "ENCORE-7777";
hash = await gate.client.writeContract({
  address: collection, abi: collectionAbi, functionName: "setGateCode",
  args: [keccak256(toBytes(CODE))],
});
await pub.waitForTransactionReceipt({ hash });
console.log(`  ok: venue code committed (${CODE})`);

// 3. Ava types the code ONCE and signs ONCE over both tickets.
const batchDigest = (tokenIds, nonce, code) =>
  keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }, { type: "bytes32" }, { type: "uint256" }, { type: "bytes32" }],
      [collection, BigInt(foundry.id), keccak256(encodePacked(["uint256[]"], [tokenIds])), nonce, keccak256(toBytes(code))],
    ),
  );

const nonce = await read("checkInNonce", [ava.account.address]);
const sig = await ava.account.signMessage({ message: { raw: batchDigest(ids, nonce, CODE) } });

// 3a. A wrong typed code must be rejected at the gate.
const badSig = await ava.account.signMessage({
  message: { raw: batchDigest(ids, nonce, "WRONG-0000") },
});
let rejected = false;
try {
  await gate.client.writeContract({
    address: collection, abi: collectionAbi, functionName: "checkInBatch",
    args: [ids, "WRONG-0000", badSig],
  });
} catch {
  rejected = true;
}
assert(rejected, "wrong venue code rejected");

// 4. Gate submits ONE batch check-in for both tickets and pays the gas.
const avaBalanceBefore = await pub.getBalance({ address: ava.account.address });
hash = await gate.client.writeContract({
  address: collection, abi: collectionAbi, functionName: "checkInBatch",
  args: [ids, CODE, sig],
});
await pub.waitForTransactionReceipt({ hash });

// 5. Outcomes: both tickets returned, two stubs, double loyalty, zero gas.
for (const id of ids) {
  assert((await read("ownerOf", [id])) === organizer, `ticket #${id} returned to event wallet`);
}
const stubsAfter = await pub.readContract({
  address: stubAddr, abi: stubAbi, functionName: "balanceOf", args: [ava.account.address],
});
assert(stubsAfter - stubsBefore === 2n, `two souvenir stubs minted (+${stubsAfter - stubsBefore})`);
const scoreAfter = await pub.readContract({
  address: loyaltyAddr, abi: loyaltyAbi, functionName: "scoreOf", args: [ava.account.address],
});
assert(scoreAfter - scoreBefore === 20n, `loyalty credited twice (+${scoreAfter - scoreBefore})`);
const avaBalanceAfter = await pub.getBalance({ address: ava.account.address });
assert(avaBalanceAfter === avaBalanceBefore, "check-in cost Ava zero gas");

console.log("\nE2E PASSED — cart buy (1 tx) → code once → sign once → batch gate check-in");

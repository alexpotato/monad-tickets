// Reproduce the gate check-in end to end against the live (new) deployment.
import {
  createPublicClient, createWalletClient, http, parseAbi, parseEther, defineChain,
  keccak256, toBytes, encodeAbiParameters,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const RPC = "https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL";
const chain = defineChain({ id: 10143, name: "Monad", nativeCurrency: { name:"MON",symbol:"MON",decimals:18 }, rpcUrls:{default:{http:[RPC]}} });
const pub = createPublicClient({ chain, transport: http(RPC) });

const FACTORY = "0x57688e8945508c9ac860ab6DAe8B1761C1E61087";
const SPONSOR = "0x8621db44fe63c1e243c07da91197e5a5270b6d4359a8aa65c7c68bbd5c2ad8bc";
const GATE = "0xe1cf09908e2a03578b2b73bb225c720ba43fe00312c9d005b8cf337eb5b58dbd";

const colAbi = parseAbi([
  "function events(uint256) view returns (address)",
  "function buySeat(string) payable returns (uint256)",
  "function seatListing(bytes32) view returns (uint16,uint256,bool,uint256)",
  "function checkInNonce(address) view returns (uint256)",
  "function setGateCode(bytes32)",
  "function checkIn(uint256,string,bytes)",
  "function ownerOf(uint256) view returns (address)",
  "function GATE_ROLE() view returns (bytes32)",
  "function hasRole(bytes32,address) view returns (bool)",
]);

const coll = await pub.readContract({ address: FACTORY, abi: parseAbi(["function events(uint256) view returns (address)"]), functionName: "events", args: [0n] });
console.log("collection:", coll);

// Is the gate key actually granted GATE_ROLE on THIS collection?
const gateAddr = privateKeyToAccount(GATE).address;
const gateRole = await pub.readContract({ address: coll, abi: colAbi, functionName: "GATE_ROLE" });
const gateHasRole = await pub.readContract({ address: coll, abi: colAbi, functionName: "hasRole", args: [gateRole, gateAddr] });
console.log(`gate ${gateAddr.slice(0,10)}… has GATE_ROLE: ${gateHasRole}`);

// Fund a fresh buyer, buy a seat.
const buyer = privateKeyToAccount(generatePrivateKey());
const sponsor = createWalletClient({ account: privateKeyToAccount(SPONSOR), chain, transport: http(RPC) });
await pub.waitForTransactionReceipt({ hash: await sponsor.sendTransaction({ to: buyer.address, value: parseEther("1") }) });
const seat = "Z-2";
const buyHash = await createWalletClient({ account: buyer, chain, transport: http(RPC) })
  .writeContract({ address: coll, abi: colAbi, functionName: "buySeat", args: [seat], value: parseEther("0.01") });
await pub.waitForTransactionReceipt({ hash: buyHash });
const [, , , tokenId] = await pub.readContract({ address: coll, abi: colAbi, functionName: "seatListing", args: [keccak256(toBytes(seat))] });
console.log(`bought ${seat} → token #${tokenId}, owner ${(await pub.readContract({address:coll,abi:colAbi,functionName:"ownerOf",args:[tokenId]})).slice(0,10)}…`);

// Gate rotates code.
const CODE = "RIFF-1234";
const gate = createWalletClient({ account: privateKeyToAccount(GATE), chain, transport: http(RPC) });
await pub.waitForTransactionReceipt({ hash: await gate.writeContract({ address: coll, abi: colAbi, functionName: "setGateCode", args: [keccak256(toBytes(CODE))] }) });
console.log("gate code set:", CODE);

// Buyer signs the check-in digest (same as web checkInDigest).
const nonce = await pub.readContract({ address: coll, abi: colAbi, functionName: "checkInNonce", args: [buyer.address] });
const digest = keccak256(encodeAbiParameters(
  [{type:"address"},{type:"uint256"},{type:"uint256"},{type:"uint256"},{type:"bytes32"}],
  [coll, 10143n, tokenId, nonce, keccak256(toBytes(CODE))],
));
const sig = await buyer.signMessage({ message: { raw: digest } });

// Gate submits the check-in.
try {
  const h = await gate.writeContract({ address: coll, abi: colAbi, functionName: "checkIn", args: [tokenId, CODE, sig], gas: 500000n });
  const r = await pub.waitForTransactionReceipt({ hash: h });
  console.log(r.status === "success" ? "✅ CHECK-IN SUCCEEDED" : "❌ check-in tx REVERTED on-chain");
} catch (e) {
  console.log("❌ check-in failed:", String(e.message).split("\n").slice(0,6).join(" | "));
}

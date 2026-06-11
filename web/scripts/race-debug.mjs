import { createWalletClient, createPublicClient, http, parseAbi, parseEther, formatEther, defineChain, keccak256, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const RPC = "https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL";
const chain = defineChain({ id:10143, name:"Monad", nativeCurrency:{name:"MON",symbol:"MON",decimals:18}, rpcUrls:{default:{http:[RPC]}} });
const pub = createPublicClient({ chain, transport: http(RPC) });
const COLL="0x5EEb2d77d61F667a9bf08dFD9f4eb9349274F8DE";
const abi = parseAbi(["function buySeat(string) payable returns (uint256)"]);
const sponsor = createWalletClient({ account: privateKeyToAccount("0x8621db44fe63c1e243c07da91197e5a5270b6d4359a8aa65c7c68bbd5c2ad8bc"), chain, transport: http(RPC) });
const b = privateKeyToAccount(generatePrivateKey());
const fh = await sponsor.sendTransaction({ to: b.address, value: parseEther("0.05") });
await pub.waitForTransactionReceipt({ hash: fh });
console.log("buyer balance:", formatEther(await pub.getBalance({ address: b.address })), "MON");
console.log("gas price:", (await pub.getGasPrice()).toString());
try {
  const h = await createWalletClient({ account: b, chain, transport: http(RPC) })
    .writeContract({ address: COLL, abi, functionName: "buySeat", args: ["T-7"], value: parseEther("0.01") });
  const rcpt = await pub.waitForTransactionReceipt({ hash: h });
  console.log("✅ bought T-7, status:", rcpt.status, "gasUsed:", rcpt.gasUsed.toString());
} catch (e) {
  console.log("❌ full error:");
  console.log(String(e.message).split("\n").slice(0, 8).join("\n"));
}

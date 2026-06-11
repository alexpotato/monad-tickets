import { createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther, defineChain } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const RPC="https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL";
const chain=defineChain({id:10143,name:"Monad",nativeCurrency:{name:"MON",symbol:"MON",decimals:18},rpcUrls:{default:{http:[RPC]}}});
const pub=createPublicClient({chain,transport:http(RPC)});
const COLL="0x98b0ed912D20367bC961c99A12BEA9e06F3383E9";
const abi=parseAbi([
  "function buySeat(string) payable returns (uint256)",
  "function seatListing(bytes32) view returns (uint16,uint256,bool,uint256)",
  "error SeatUnavailable()","error WrongPayment()",
]);
const sponsor=createWalletClient({account:privateKeyToAccount("0x8621db44fe63c1e243c07da91197e5a5270b6d4359a8aa65c7c68bbd5c2ad8bc"),chain,transport:http(RPC)});
const buyer=privateKeyToAccount(generatePrivateKey());
await pub.waitForTransactionReceipt({ hash: await sponsor.sendTransaction({ to: buyer.address, value: parseEther("0.5") }) });
console.log("buyer bal:", formatEther(await pub.getBalance({address:buyer.address})));
try {
  const r = await pub.simulateContract({ account: buyer.address, address: COLL, abi, functionName:"buySeat", args:["FIX-1"], value: parseEther("0.01") });
  console.log("simulate OK → would mint token", r.result.toString());
} catch(e) {
  console.log("revert name:", e.cause?.data?.errorName ?? e.cause?.reason ?? "(none)");
  console.log("short:", String(e.shortMessage ?? e.message).split("\n").slice(0,3).join(" "));
}

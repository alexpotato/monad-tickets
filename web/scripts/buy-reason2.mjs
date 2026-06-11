import { createPublicClient, createWalletClient, http, parseAbi, parseEther, formatEther, defineChain, keccak256, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const RPC="https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL";
const chain=defineChain({id:10143,name:"Monad",nativeCurrency:{name:"MON",symbol:"MON",decimals:18},rpcUrls:{default:{http:[RPC]}}});
const pub=createPublicClient({chain,transport:http(RPC)});
const FACTORY="0x57688e8945508c9ac860ab6DAe8B1761C1E61087";
const abi=parseAbi(["function events(uint256) view returns (address)","function buySeat(string) payable returns (uint256)","function seatListing(bytes32) view returns (uint16 tier,uint256 price,bool active,uint256 tokenId)","function listSeats(string[],uint16,uint256)","error SeatUnavailable()","error WrongPayment()"]);
const coll=await pub.readContract({address:FACTORY,abi,functionName:"events",args:[0n]});
const org=createWalletClient({account:privateKeyToAccount("0x5213b386f221f3031a06c173ceb4c18b9e55e6152241a49e0f782113f92a4ed6"),chain,transport:http(RPC)});
const sponsor=createWalletClient({account:privateKeyToAccount("0x8621db44fe63c1e243c07da91197e5a5270b6d4359a8aa65c7c68bbd5c2ad8bc"),chain,transport:http(RPC)});
const SEAT="RSN-"+Date.now().toString().slice(-5);
await pub.waitForTransactionReceipt({hash: await org.writeContract({address:coll,abi,functionName:"listSeats",args:[[SEAT],0,parseEther("0.01")],gas:400000n})});
const L=await pub.readContract({address:coll,abi,functionName:"seatListing",args:[keccak256(toBytes(SEAT))]});
console.log(`${SEAT}: active=${L.active} price=${formatEther(L.price)} tokenId=${L.tokenId}`);
const buyer=privateKeyToAccount(generatePrivateKey());
await pub.waitForTransactionReceipt({hash: await sponsor.sendTransaction({to:buyer.address,value:parseEther("0.5")})});
console.log("buyer bal:", formatEther(await pub.getBalance({address:buyer.address})));
try {
  const r=await pub.simulateContract({account:buyer.address,address:coll,abi,functionName:"buySeat",args:[SEAT],value:parseEther("0.01")});
  console.log("✅ simulate OK → token", r.result.toString());
} catch(e){
  console.log("revert:", e.cause?.data?.errorName ?? e.cause?.shortMessage ?? String(e.shortMessage??e.message).split("\n")[0]);
}

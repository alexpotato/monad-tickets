// Same-seat race, but CHECK RECEIPT STATUS (mined-but-reverted != success).
import { createWalletClient, createPublicClient, http, parseAbi, parseEther, formatEther, defineChain, keccak256, toBytes } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
const RPC="https://can-007.devcore4.com/rpc/Vc9Blo3MtwRGdJnYMmE1KwCO3t6iY9xL";
const chain=defineChain({id:10143,name:"Monad",nativeCurrency:{name:"MON",symbol:"MON",decimals:18},rpcUrls:{default:{http:[RPC]}}});
const pub=createPublicClient({chain,transport:http(RPC)});
const COLL="0x5EEb2d77d61F667a9bf08dFD9f4eb9349274F8DE";
const abi=parseAbi(["function buySeat(string) payable returns (uint256)","function seatListing(bytes32) view returns (uint16,uint256,bool,uint256)","function ownerOf(uint256) view returns (address)"]);
const sponsor=createWalletClient({account:privateKeyToAccount("0x8621db44fe63c1e243c07da91197e5a5270b6d4359a8aa65c7c68bbd5c2ad8bc"),chain,transport:http(RPC)});
const SEAT="T-8";
const N=6;
const buyers=Array.from({length:N},()=>privateKeyToAccount(generatePrivateKey()));
let nonce=await pub.getTransactionCount({address:sponsor.account.address});
const fh=[]; for(const b of buyers) fh.push(await sponsor.sendTransaction({to:b.address,value:parseEther("0.5"),nonce:nonce++}));
await Promise.all(fh.map(h=>pub.waitForTransactionReceipt({hash:h})));
console.log(`Funded ${N}. All race for ${SEAT}.\n`);

const attempt = async (acct) => {
  try {
    // disable viem's gas estimation pre-flight so reverting txs still BROADCAST
    // (that's what a real mempool race looks like — txs land, then revert on-chain)
    const hash = await createWalletClient({account:acct,chain,transport:http(RPC)})
      .writeContract({address:COLL,abi,functionName:"buySeat",args:[SEAT],value:parseEther("0.01"),gas:500000n});
    const r = await pub.waitForTransactionReceipt({hash});
    return { who:acct.address, sent:true, status:r.status, hash };
  } catch(e) {
    const m = String(e.message).match(/SeatUnavailable|insufficient|reverted|nonce/i)?.[0] ?? "rejected@send";
    return { who:acct.address, sent:false, why:m };
  }
};
const res = await Promise.all(buyers.map(attempt));
let minted=0;
for (const r of res) {
  if (r.sent) { console.log(`  tx mined: status=${r.status} ${r.status==="success"?"✅ MINTED":"⛔ reverted on-chain"} ${r.who.slice(0,10)}…`); if(r.status==="success") minted++; }
  else console.log(`  not sent: ${r.why} ${r.who.slice(0,10)}…`);
}
const [, , , tid] = await pub.readContract({address:COLL,abi,functionName:"seatListing",args:[keccak256(toBytes(SEAT))]});
const owner = tid!==0n ? await pub.readContract({address:COLL,abi,functionName:"ownerOf",args:[tid]}) : null;
console.log(`\n  successful mints: ${minted} (must be 1)`);
console.log(`  ${SEAT} tokenId: ${tid}  owner: ${owner?.slice(0,10) ?? "—"}…`);
console.log(minted===1 && tid!==0n ? "\nPASS — exactly one mint won the seat; the rest reverted on-chain. No double-sell." : "\nFAIL");

import { createPublicClient, custom, http, parseAbi, defineChain } from "viem";
const chain = defineChain({ id:10143, name:"Monad", nativeCurrency:{name:"MON",symbol:"MON",decimals:18}, rpcUrls:{default:{http:["https://testnet-rpc.monad.xyz"]}}, contracts:{ multicall3:{ address:"0xcA11bde05977b3631167028862bE2a173976CA11" } } });
const GAP = 90; let retries = 0;
function throttled() {
  const inner = http(undefined, { batch:{ wait:120 } })({ chain });
  let q = Promise.resolve();
  const rl = e => /(-32011|limited to|429|rate)/.test(String(e?.message ?? e));
  async function send(a){ for(let k=0;;k++){ if(GAP) await new Promise(z=>setTimeout(z,GAP)); try { return await inner.request(a);} catch(e){ if(rl(e)&&k<6){retries++; await new Promise(z=>setTimeout(z,300*2**k)); continue;} throw e; } } }
  return custom({ request(a){ const r=q.then(()=>send(a)); q=r.catch(()=>undefined); return r; } });
}
const c = createPublicClient({ chain, transport: throttled() });
const f="0x592750D487B8862fEd7a7c072EE9c3882D8De440";
const a=parseAbi(["function events(uint256) view returns (address)","function name() view returns (string)","function organizer() view returns (address)","function stub() view returns (address)","function loyalty() view returns (address)","function eventStartTime() view returns (uint64)","function resaleCap() view returns (uint256)","function allSeats() view returns (string[])"]);
const sa=parseAbi(["function ownerOf(uint256) view returns (address)","function provenance(uint256) view returns (address,uint256,uint64)"]);
const t0=Date.now();
const coll=await c.readContract({address:f,abi:a,functionName:"events",args:[0n]});
const stubAddr=await c.readContract({address:coll,abi:a,functionName:"stub"});
const statics=Promise.all(["name","organizer","stub","loyalty","eventStartTime","resaleCap","allSeats"].map(fn=>c.readContract({address:coll,abi:a,functionName:fn})));
const fan=c.multicall({contracts:Array.from({length:25},(_,i)=>BigInt(i+1)).flatMap(id=>[{address:stubAddr,abi:sa,functionName:"ownerOf",args:[id]},{address:stubAddr,abi:sa,functionName:"provenance",args:[id]}]),allowFailure:true});
const bal=c.getBalance({address:f});
try { const [s]=await Promise.all([statics,fan,bal]); console.log(`✅ completed: name="${s[0]}", ${retries} retries, ${Date.now()-t0}ms`); }
catch(e){ console.log("❌ threw:", String(e.message).split("\n")[0]); process.exit(1); }

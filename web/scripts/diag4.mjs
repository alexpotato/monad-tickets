import { createPublicClient, http, parseAbi } from "viem";
import { defineChain } from "viem";
const chain = defineChain({ id: 10143, name: "Monad", nativeCurrency: { name:"MON",symbol:"MON",decimals:18 }, rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } }, contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } } });
const c = createPublicClient({ chain, transport: http(undefined, { batch: { wait: 100 } }) });
const factory = "0x592750D487B8862fEd7a7c072EE9c3882D8De440";
const coll = await c.readContract({ address: factory, abi: parseAbi(["function events(uint256) view returns (address)"]), functionName: "events", args: [0n] });
const stub = await c.readContract({ address: coll, abi: parseAbi(["function stub() view returns (address)"]), functionName: "stub" });
const stubAbi = parseAbi(["function ownerOf(uint256) view returns (address)","function provenance(uint256) view returns (address,uint256,uint64)"]);
// replicate loadStubs CHUNK=25
let total = 0;
for (let start = 1; start < 200; start += 25) {
  const ids = Array.from({length:25},(_,i)=>BigInt(start+i));
  const contracts = ids.flatMap(id => [
    { address: stub, abi: stubAbi, functionName: "ownerOf", args: [id] },
    { address: stub, abi: stubAbi, functionName: "provenance", args: [id] },
  ]);
  const t0 = Date.now();
  const res = await c.multicall({ contracts, allowFailure: true });
  total += res.length;
  const ok = res.filter(r => r.status === "success").length;
  console.log(`chunk @${start}: ${ok}/${res.length} ok, ${Date.now()-t0}ms`);
  if (res.some((r,i) => i%2===0 && r.status==="failure")) { console.log("  gap found, stop"); break; }
}

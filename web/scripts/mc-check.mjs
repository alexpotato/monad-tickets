import { createPublicClient, http, parseAbi, keccak256, toBytes, defineChain } from "viem";

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

const client = createPublicClient({ chain: monadTestnet, transport: http(undefined, { batch: { wait: 100 } }) });
const abi = parseAbi([
  "function name() view returns (string)",
  "function seatCount() view returns (uint256)",
  "function seatListing(bytes32) view returns (uint16, uint256, bool, uint256)",
]);
const collection = "0x5EEb2d77d61F667a9bf08dFD9f4eb9349274F8DE";

const results = await client.multicall({
  contracts: [
    { address: collection, abi, functionName: "name" },
    { address: collection, abi, functionName: "seatCount" },
    { address: collection, abi, functionName: "seatListing", args: [keccak256(toBytes("A-1"))] },
  ],
  allowFailure: false,
});
console.log("multicall over testnet:", results[0], "| seats:", results[1].toString(), "| A-1 listing:", results[2].map(String).join(","));

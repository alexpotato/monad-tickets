import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEther,
  keccak256,
  toBytes,
  toHex,
  encodeAbiParameters,
  encodePacked,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { activeProfile, deviceWalletKey, type ChainProfile } from "./profiles";

export const PROFILE: ChainProfile = activeProfile();

// batch: true folds concurrent reads into JSON-RPC batch requests — the
// seat-map poll is ~100 calls, which public RPCs rate-limit as individual
// requests but accept as a couple of batches.
const transport = http(PROFILE.rpcUrl, { batch: { wait: 100 } });

export const publicClient = createPublicClient({ chain: PROFILE.chain, transport });

export const POLL_MS = PROFILE.pollMs;

export function walletFor(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    client: createWalletClient({ account, chain: PROFILE.chain, transport }),
  };
}

// Demo personas for the active profile. The device wallet ("This phone") is
// always first — it's the realistic "you" account on a real phone; on local
// anvil the pre-funded named personas follow for multi-user demos.
export const PERSONAS = {
  organizer: PROFILE.roles.organizer,
  gate: PROFILE.roles.gate,
  attendees: [
    { name: "This phone", key: deviceWalletKey() },
    ...PROFILE.roles.attendees,
  ],
};

/// On anvil we can conjure balance for the freshly-generated device wallet so
/// "This phone" works with zero setup. On testnet the faucet banner handles it.
export async function autoFundIfPossible(address: Address): Promise<boolean> {
  if (!PROFILE.canAutoFund) return false;
  await publicClient.request({
    // anvil-only cheatcode
    method: "anvil_setBalance" as never,
    params: [address, toHex(parseEther("10"))] as never,
  });
  return true;
}

export const factoryAbi = parseAbi([
  "function events(uint256) view returns (address)",
  "function eventCount() view returns (uint256)",
]);

export const collectionAbi = parseAbi([
  "function name() view returns (string)",
  "function organizer() view returns (address)",
  "function loyalty() view returns (address)",
  "function stub() view returns (address)",
  "function eventStartTime() view returns (uint64)",
  "function resaleCap() view returns (uint256)",
  "function allSeats() view returns (string[])",
  "function seatListing(bytes32) view returns (uint16 tier, uint256 price, bool active, uint256 tokenId)",
  "function seatOf(uint256) view returns (string)",
  "function ownerOf(uint256) view returns (address)",
  "function ticket(uint256) view returns ((uint16 tier, uint256 facePrice, uint64 mintedAt, uint64 usedAt, uint256 lastSalePrice))",
  "function buySeat(string) payable returns (uint256)",
  "function buySeats(string[]) payable returns (uint256[])",
  "function checkInNonce(address) view returns (uint256)",
  "function setGateCode(bytes32)",
  "function checkIn(uint256, string, bytes)",
  "function checkInBatch(uint256[], string, bytes)",
  "function codeValidity() view returns (uint64)",
  "function codeSetAt() view returns (uint64)",
  "function currentCodeHash() view returns (bytes32)",
  "function listSeats(string[], uint16, uint256)",
  // declared so viem decodes reverts into readable names
  "error BadGateCode()",
  "error TicketUsed()",
  "error TransferRestricted()",
  "error SeatUnavailable()",
  "error WrongPayment()",
  "error PriceAboveCap()",
]);

export const loyaltyAbi = parseAbi([
  "function scoreOf(address) view returns (int256)",
]);

export const stubAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function provenance(uint256) view returns (address collection, uint256 ticketId, uint64 attendedAt)",
  "event StubMinted(uint256 indexed stubId, address indexed to, address indexed collection, uint256 ticketId)",
]);

/// Build the exact digest TicketCollection.checkIn verifies, pre-EIP-191.
/// signMessage({ raw }) applies the "\x19Ethereum Signed Message:\n32" prefix,
/// matching MessageHashUtils.toEthSignedMessageHash on-chain.
export function checkInDigest(
  collection: Address,
  tokenId: bigint,
  nonce: bigint,
  code: string,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [collection, BigInt(PROFILE.chain.id), tokenId, nonce, keccak256(toBytes(code))],
    ),
  );
}

/// Batch variant — one signature over the whole token list, mirroring
/// TicketCollection.checkInBatch: the inner tokenId slot becomes
/// keccak256(abi.encodePacked(tokenIds)).
export function batchCheckInDigest(
  collection: Address,
  tokenIds: bigint[],
  nonce: bigint,
  code: string,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        collection,
        BigInt(PROFILE.chain.id),
        keccak256(encodePacked(["uint256[]"], [tokenIds])),
        nonce,
        keccak256(toBytes(code)),
      ],
    ),
  );
}

export type Seat = {
  label: string;
  tier: number;
  price: bigint;
  tokenId: bigint; // 0n = unsold
  owner?: Address;
  used: boolean;
};

export type EventState = {
  collection: Address;
  name: string;
  organizer: Address;
  loyalty: Address;
  stub: Address;
  eventStartTime: bigint;
  resaleCap: bigint;
  seats: Seat[];
};

/// One polling read of everything the panes need. Demo-scale (tens of seats),
/// so plain parallel eth_calls are fine.
export type LoadResult = EventState | "no-factory" | "rpc-down";

// The collection address and event config are immutable — fetch once and
// reuse so the steady-state poll is ~2 HTTP requests. The public testnet RPC
// has a tight per-IP burst limit (~4 rapid requests trips a 429).
type Statics = Omit<EventState, "seats">;
let statics: Statics | null = null;

export async function loadEventState(): Promise<LoadResult> {
  if (PROFILE.factory === null) return "no-factory";
  try {
    if (!statics) {
      const collection = await publicClient.readContract({
        address: PROFILE.factory,
        abi: factoryAbi,
        functionName: "events",
        args: [0n],
      });
      const [name, organizer, loyalty, stub, eventStartTime, resaleCap] = (await readAll(
        collection,
        [
          ["name", []],
          ["organizer", []],
          ["loyalty", []],
          ["stub", []],
          ["eventStartTime", []],
          ["resaleCap", []],
        ],
      )) as [string, Address, Address, Address, bigint, bigint];
      statics = { collection, name, organizer, loyalty, stub, eventStartTime, resaleCap };
    }
    const collection = statics.collection;
    const labels = await readAll<string[]>(collection, [["allSeats", []]]).then((r) => r[0]);

    // One round for every listing, one more for sold-seat details. On testnet
    // each round is a single Multicall3 eth_call; on anvil it's a JSON-RPC
    // batch (no Multicall3 predeploy there, and no rate limit either).
    const listings = await readAll<[number, bigint, boolean, bigint]>(
      collection,
      labels.map((label) => ["seatListing", [keccak256(toBytes(label))]]),
    );
    const soldIdx = listings
      .map((l, i) => (l[3] !== 0n ? i : -1))
      .filter((i) => i >= 0);
    const details = await readAll<unknown>(
      collection,
      soldIdx.flatMap((i) => [
        ["ownerOf", [listings[i][3]]],
        ["ticket", [listings[i][3]]],
      ]),
    );

    const detailByIdx = new Map<number, { owner: Address; used: boolean }>();
    soldIdx.forEach((seatIdx, k) => {
      const owner = details[k * 2] as Address;
      const t = details[k * 2 + 1] as { usedAt: bigint };
      detailByIdx.set(seatIdx, { owner, used: t.usedAt !== 0n });
    });

    const seats: Seat[] = labels.map((label, i) => {
      const [tier, price, , tokenId] = listings[i];
      const d = detailByIdx.get(i);
      return { label, tier, price, tokenId, owner: d?.owner, used: d?.used ?? false };
    });

    return { ...statics, seats };
  } catch {
    return "rpc-down"; // unreachable, rate-limited, or not seeded
  }
}

/// Read many functions off one contract in a single round: Multicall3 where
/// the chain has it (one eth_call total), otherwise a parallel batch.
async function readAll<T>(
  address: Address,
  calls: [string, unknown[]][],
): Promise<T[]> {
  if (calls.length === 0) return [];
  const contracts = calls.map(([functionName, args]) => ({
    address,
    abi: collectionAbi,
    functionName,
    args,
  }));
  if (PROFILE.chain.contracts?.multicall3) {
    const results = await publicClient.multicall({
      contracts: contracts as never,
      allowFailure: false,
    });
    return results as T[];
  }
  return Promise.all(
    contracts.map((c) => publicClient.readContract(c as never) as Promise<T>),
  );
}

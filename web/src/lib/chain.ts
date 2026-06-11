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
      const readC = <T,>(functionName: string) =>
        publicClient.readContract({
          address: collection,
          abi: collectionAbi,
          functionName,
        } as never) as Promise<T>;
      const [name, organizer, loyalty, stub, eventStartTime, resaleCap] = await Promise.all([
        readC<string>("name"),
        readC<Address>("organizer"),
        readC<Address>("loyalty"),
        readC<Address>("stub"),
        readC<bigint>("eventStartTime"),
        readC<bigint>("resaleCap"),
      ]);
      statics = { collection, name, organizer, loyalty, stub, eventStartTime, resaleCap };
    }
    const collection = statics.collection;
    const read = <T,>(functionName: string, args: unknown[] = []) =>
      publicClient.readContract({
        address: collection,
        abi: collectionAbi,
        functionName,
        args,
      } as never) as Promise<T>;

    const labels = await read<string[]>("allSeats");

    const seats: Seat[] = await Promise.all(
      labels.map(async (label) => {
        const [tier, price, , tokenId] = await read<[number, bigint, boolean, bigint]>(
          "seatListing",
          [keccak256(toBytes(label))],
        );
        let owner: Address | undefined;
        let used = false;
        if (tokenId !== 0n) {
          const [o, t] = await Promise.all([
            read<Address>("ownerOf", [tokenId]),
            read<{ usedAt: bigint }>("ticket", [tokenId]),
          ]);
          owner = o;
          used = t.usedAt !== 0n;
        }
        return { label, tier, price, tokenId, owner, used };
      }),
    );

    return { ...statics, seats };
  } catch {
    return "rpc-down"; // unreachable, rate-limited, or not seeded
  }
}

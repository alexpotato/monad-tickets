import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toBytes,
  encodeAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

export const RPC_URL = "http://127.0.0.1:8545";
// Deterministic on a fresh anvil node seeded with contracts/script/Demo.s.sol.
export const FACTORY_ADDRESS: Address = "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9";

export const publicClient = createPublicClient({ chain: foundry, transport: http(RPC_URL) });

export function walletFor(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  return {
    account,
    client: createWalletClient({ account, chain: foundry, transport: http(RPC_URL) }),
  };
}

// anvil's well-known accounts, used as demo personas
export const PERSONAS = {
  organizer: {
    name: "Olivia (Organizer)",
    key: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as Hex,
  },
  gate: {
    name: "Gate Device",
    key: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as Hex,
  },
  attendees: [
    { name: "Ava", key: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex },
    { name: "Ben", key: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex },
    { name: "Cleo", key: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex },
  ],
};

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
  "function checkInNonce(address) view returns (uint256)",
  "function setGateCode(bytes32)",
  "function checkIn(uint256, string, bytes)",
  "function codeValidity() view returns (uint64)",
  "function codeSetAt() view returns (uint64)",
  "function listSeats(string[], uint16, uint256)",
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
      [collection, BigInt(foundry.id), tokenId, nonce, keccak256(toBytes(code))],
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
export async function loadEventState(): Promise<EventState | null> {
  try {
    const collection = await publicClient.readContract({
      address: FACTORY_ADDRESS,
      abi: factoryAbi,
      functionName: "events",
      args: [0n],
    });
    const read = <T,>(functionName: string, args: unknown[] = []) =>
      publicClient.readContract({
        address: collection,
        abi: collectionAbi,
        functionName,
        args,
      } as never) as Promise<T>;

    const [name, organizer, loyalty, stub, eventStartTime, resaleCap, labels] =
      await Promise.all([
        read<string>("name"),
        read<Address>("organizer"),
        read<Address>("loyalty"),
        read<Address>("stub"),
        read<bigint>("eventStartTime"),
        read<bigint>("resaleCap"),
        read<string[]>("allSeats"),
      ]);

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

    return { collection, name, organizer, loyalty, stub, eventStartTime, resaleCap, seats };
  } catch {
    return null; // anvil not running / not seeded
  }
}

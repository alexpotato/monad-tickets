import {
  createPublicClient,
  createWalletClient,
  custom,
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

// The public testnet RPC enforces "15 requests/sec" per IP (error -32011; some
// gateways answer 429). batch:{wait} already folds concurrent reads into a few
// JSON-RPC batch POSTs, but several panes polling at once (App's seat-map poll
// + Company's stub roster + balance reads) can still spike past the ceiling and
// fail a whole load — which surfaces as "chain unreachable". Wrap the HTTP
// transport so that (1) outgoing requests pass through a single app-wide queue
// with a minimum gap, and (2) a rate-limit error waits and retries instead of
// bubbling up. Anvil is unlimited, so the gap is 0 and retries never trigger.
// The dedicated testnet RPC has no burst cap, so no gap is needed; the
// retry-on-rate-limit below stays as a harmless safety net if the endpoint
// ever changes. (The old public endpoint needed ~90ms here.)
const MIN_REQUEST_GAP_MS = 0;

function isRateLimit(e: unknown): boolean {
  const s = String((e as Error)?.message ?? e);
  return s.includes("-32011") || s.includes("limited to") || s.includes("429") || s.includes("rate");
}

function throttledTransport() {
  // Keep JSON-RPC batching ON (multicall + a single eth_call still go as one
  // POST) but serialize the *POSTs themselves* through one global queue: each
  // waits for the previous to finish, then for a fixed gap, before sending.
  // ~90ms gap → ≤11 POST/s, safely under the 15/s cap, no matter how many
  // panes poll. A rate-limit response still retries with backoff as a belt.
  const inner = http(PROFILE.rpcUrl, { batch: { wait: 120 } })({ chain: PROFILE.chain });
  let queue: Promise<unknown> = Promise.resolve();

  async function send(args: unknown): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      if (MIN_REQUEST_GAP_MS) await new Promise((r) => setTimeout(r, MIN_REQUEST_GAP_MS));
      try {
        return await inner.request(args as never);
      } catch (e) {
        if (isRateLimit(e) && attempt < 6) {
          await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
          continue;
        }
        throw e;
      }
    }
  }

  return custom({
    request(args) {
      // chain onto the queue; failures don't poison the queue for the next caller
      const result = queue.then(() => send(args));
      queue = result.catch(() => undefined);
      return result as never;
    },
  });
}

const transport = throttledTransport();

// pollingInterval drives waitForTransactionReceipt; Monad blocks are sub-second
// so viem's 4s default adds pointless latency to every confirmed action.
export const publicClient = createPublicClient({
  chain: PROFILE.chain,
  transport,
  pollingInterval: 1_000,
});

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
  "function ownerOf(uint256) view returns (address)",
  "function provenance(uint256) view returns (address collection, uint256 ticketId, uint64 attendedAt)",
  "event StubMinted(uint256 indexed stubId, address indexed to, address indexed collection, uint256 ticketId)",
]);

export type StubInfo = { stubId: bigint; owner: Address; ticketId: bigint };

/// Enumerate every minted stub — the attendance ledger — WITHOUT logs.
/// (The public testnet RPC caps eth_getLogs to 100 blocks, useless for
/// history.) Stub ids are sequential from 1, so probe ownerOf/provenance in
/// chunks: one Multicall3 eth_call per 25 ids on testnet, a batch on anvil;
/// stop at the first nonexistent id.
export async function loadStubs(stubAddr: Address): Promise<StubInfo[]> {
  const out: StubInfo[] = [];
  const CHUNK = 25;
  for (let start = 1; start < 2000; start += CHUNK) {
    const ids = Array.from({ length: CHUNK }, (_, i) => BigInt(start + i));
    const contracts = ids.flatMap((id) => [
      { address: stubAddr, abi: stubAbi, functionName: "ownerOf", args: [id] },
      { address: stubAddr, abi: stubAbi, functionName: "provenance", args: [id] },
    ]);
    type R = { status: "success" | "failure"; result?: unknown };
    let results: R[];
    if (PROFILE.chain.contracts?.multicall3) {
      results = (await publicClient.multicall({
        contracts: contracts as never,
        allowFailure: true,
      })) as R[];
    } else {
      results = await Promise.all(
        contracts.map((c) =>
          (publicClient.readContract(c as never) as Promise<unknown>).then(
            (result) => ({ status: "success" as const, result }),
            () => ({ status: "failure" as const }),
          ),
        ),
      );
    }
    let sawGap = false;
    for (let i = 0; i < ids.length; i++) {
      const owner = results[i * 2];
      const prov = results[i * 2 + 1];
      if (owner.status === "success") {
        const [, ticketId] = prov.result as [Address, bigint, bigint];
        out.push({ stubId: ids[i], owner: owner.result as Address, ticketId });
      } else {
        sawGap = true;
        break;
      }
    }
    if (sawGap) break;
  }
  return out;
}

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

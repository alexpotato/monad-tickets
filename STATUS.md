# Build Status — On-Chain Ticketing on Monad

Last updated: 2026-06-10.

## What exists

A working Foundry project under `contracts/` implementing the full design in
[ARCHITECTURE.md](./ARCHITECTURE.md) — six contracts, 39 passing tests, deploy
script verified on anvil — plus a **demo web app under `web/`** (Vite + React +
viem) with three surfaces: organizer dashboard (list seats, watch sales and
check-ins), attendee phone simulator (buy seats, hold tickets, check in), and
venue gate (rotating code + scanner). See `web/README.md` for the run book.
The web app is an installable PWA hosted at
https://alexpotato.github.io/monad-tickets/ (GitHub Pages, repo
alexpotato/monad-tickets, deployed by .github/workflows/pages.yml). Chain
profiles: local anvil + Monad testnet (10143); testnet contracts deploy via
TESTNET.md runbook, then paste the factory address into
web/src/lib/profiles.ts.

```
contracts/
  src/
    LoyaltyRegistry.sol        soulbound per-wallet reputation
    AttendanceStub.sol         soulbound souvenir minted at check-in
    TicketCollection.sol       ERC-721 per event, restricted transfer + check-in
    ResaleMarketplace.sol      capped fixed-price resale, royalty, flip penalty
    TicketAuction.sol          score-weighted auction (primary + resale)
    EventFactory.sol           deploys + wires per-event collections
    interfaces/
      ILoyaltyRegistry.sol
      ITicketCollection.sol
      IAttendanceStub.sol
  test/
    Base.t.sol                 shared deploy + helpers (signing, code, check-in)
    LoyaltyRegistry.t.sol      4 tests
    TicketCollection.t.sol     24 tests
    ResaleMarketplace.t.sol    4 tests
    TicketAuction.t.sol        6 tests
    E2E.t.sol                  1 full-lifecycle test
  script/Deploy.s.sol          bare system deploy
  script/Demo.s.sol            deploy + seed demo event with a 30-seat map
  foundry.toml                 solc 0.8.28, via_ir=true, OZ v5.1.0 remapped

web/
  src/lib/chain.ts             viem clients, ABIs, personas, check-in digest
  src/lib/bus.ts               BroadcastChannel "QR scan" simulation
  src/panes/{Organizer,Attendee,Gate}.tsx
  scripts/e2e.mjs              headless run of the full UI flow (npm run e2e)
```

## Commands

```bash
cd contracts
forge build
forge test                                    # 39 tests, all passing
forge test --match-path test/E2E.t.sol -vv    # full lifecycle

# Demo web app (organizer + attendee phone + gate)
anvil &
forge script script/Demo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
cd ../web && npm install && npm run dev       # http://localhost:5173
npm run e2e                                   # headless UI-flow verification

anvil &
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

## Key implementation facts / decisions made during the build

- **Solc 0.8.28 with `via_ir = true`** — required because `TicketCollection`'s
  constructor has enough params to hit "stack too deep" without the IR pipeline.
- **OpenZeppelin v5.1.0**, remapped as `@openzeppelin/contracts/`.
- **Restricted transfer** is enforced in `TicketCollection._update`: permits
  mint/burn, `MARKET_ROLE`, and `ORGANIZER_ROLE` movers; everything else reverts
  with `TransferRestricted`. Used tickets (`usedAt != 0`) revert with
  `TicketUsed`.
- **Privileged movement goes through `marketTransfer`, not raw `transferFrom`.**
  Solidity's `_update` privilege and ERC-721's approval gate (`_isAuthorized`)
  are independent checks — a privileged role still fails the approval gate on a
  raw `transferFrom`. So the marketplace/auction move tickets via
  `marketTransfer` (which uses `_safeTransfer` internally). This is the safer
  design: no role can seize a ticket via `transferFrom` without approval.
- **Check-in is a ticket swap (2026-06-10 redesign).** The attendee types the
  venue-displayed rotating code; the app builds the digest
  `toEthSignedMessageHash(keccak256(abi.encode(collection, chainid, tokenId,
  nonce, keccak256(code))))`; the holder signs; the `GATE_ROLE` device submits
  `checkIn(tokenId, code, holderSig)` and pays gas (free for the attendee). On
  success: ticket transfers holder → organizer (event wallet) under a scoped
  `_inCheckIn` flag in `_update`, `usedAt` set, soulbound `AttendanceStub`
  minted to the holder, loyalty credited. Per-holder `checkInNonce` blocks
  replay.
- **Rotating venue code:** `setGateCode(bytes32 codeHash)` (gate or organizer)
  commits the hash; plaintext shows on venue screens. `codeValidity` defaults
  to 15 min (organizer-settable); the previous code stays valid for a 2-min
  `CODE_GRACE` after rotation so just-built signatures still land. Contract
  checks the submitted code against the active/grace commitment AND the
  signature binds the holder to that exact code. (A code proves knowledge, not
  GPS — short windows + gate submission mitigate.)
- **AttendanceStub** is mint-only soulbound (`_update` reverts when
  `from != 0`); records provenance (collection, ticket id, attendedAt). The
  factory grants each new collection `MINTER_ROLE`; the factory must hold stub
  admin (deploy script + test base both grant it right after construction).
- **Auction model chosen: first-price ascending with score handicap.** Each bid
  escrows `msg.value`; ranking is by `effectiveBid = bid + bid*bonusBps/10_000`;
  the winner pays their *own* raw bid; outbid deposits are pulled back via
  `withdrawRefund`. (The plan left sealed-vs-ascending open; ascending was
  picked for implementability — revisit if sealed-bid privacy is wanted.)
- **Loyalty handicap** lives in `LoyaltyRegistry.bonusBpsFor(wallet, bpsPerPoint,
  maxBonusBps)`: `min(score*bpsPerPoint, maxBonusBps)`, zero for non-positive
  scores (never a malus that could underflow a bid).
- **Flip penalty** = `baseFlipPenalty` + a margin component: `+1` point per 10%
  of face captured as margin. Selling at/below face is only the base penalty.
- **Role wiring**: `EventFactory.wireSharedContracts()` grants the shared market
  + auction `WRITER_ROLE` on the registry (idempotent), called at the top of
  `createEvent`. The factory must be a `LoyaltyRegistry` admin first (the deploy
  script and test base both do this right after constructing the factory). The
  `TicketCollection` constructor grants `DEFAULT_ADMIN_ROLE` to *both* the
  organizer and the deployer (factory) so the factory can grant the auction
  `MARKET_ROLE` post-deploy.

## Key facts about the demo web app (2026-06-10)

- **Primary sale is now on-chain**: `TicketCollection.listSeats(labels, tier,
  price)` (organizer) + `buySeat(label)` / `buySeats(labels[])` payable (buyer
  mints directly, pays organizer; batch is one tx, all-or-nothing, value must
  equal the sum). `seatOf(tokenId)` maps tickets to seat labels; `allSeats()`
  enumerates for UIs.
- **Batch check-in**: `checkInBatch(tokenIds[], code, holderSig)` — same-holder
  tickets, venue code typed once, ONE signature over
  `keccak256(abi.encodePacked(tokenIds))` in the digest's tokenId slot, atomic.
  The UI cart/selection flows use the batch paths exclusively (single = batch
  of one). JS mirror: `batchCheckInDigest` in `web/src/lib/chain.ts`.
- Web app is dependency-light: react, react-dom, viem only. Hash routing
  (`#/organizer`, `#/attendee`, `#/gate`; default = all three side by side).
- Personas = anvil well-known accounts (no wallet extension): #0 admin,
  #1 organizer, #2 gate, #3-5 attendees (Ava/Ben/Cleo). Keys hardcoded in
  `web/src/lib/chain.ts` — fine, they're anvil's public dev keys.
- Factory address `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` is deterministic
  for a fresh anvil seeded by `Demo.s.sol` (account #0, fifth CREATE). The app
  discovers everything else (collection, loyalty, stub) from the factory.
- The check-in digest in JS (`checkInDigest` in chain.ts) must stay in lockstep
  with `TicketCollection.checkIn`: keccak256(abi.encode(collection, chainid,
  tokenId, nonce, keccak256(code))) signed via signMessage({raw}) = EIP-191.
- QR hand-off simulated via BroadcastChannel (works same-page and cross-tab).
  `npm run e2e` (web/scripts/e2e.mjs) drives the identical calls headlessly.

## Not yet built (per ARCHITECTURE.md)

- Presale gating + tiered discounts at primary mint (registry read surface
  exists; seat prices are flat per listing — no score-based discount yet).
- Indexer (`/indexer`); the web app reads chain state directly by polling.
- Metadata / tokenURI (no IPFS hookup yet).
- Resale/auction UI in the web app (contracts fully support it; demo covers
  primary sale + check-in).
- Event-cancellation / refund buyback flow.
- Anti-sniping auto-extend on auctions.

## Open design questions (unchanged from ARCHITECTURE.md)

- Resale cap exactly at face vs face + bps.
- Sealed-bid vs ascending vs Dutch auction format.
- Exact score curve (attendance reward, flip penalty scaling, presale
  thresholds, discount sizes).

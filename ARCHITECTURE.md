# On-Chain Ticketing on Monad — Architecture

## Context

We want a Ticketmaster-style primary + resale ticketing platform where **every
resale happens on-chain**. The motivating goal is anti-scalping: by capturing
the full transfer provenance of each ticket and tying real attendance to a
wallet at check-in, we can distinguish genuine attendees from scalpers — and
reward the former rather than merely punishing the latter.

Decisions locked with the user:

- **Resale policy: hybrid loyalty.** Resale is permitted but routed through an
  official, price-capped marketplace. Holders who attend (rather than flip)
  accrue a non-transferable reputation that unlocks future presale priority and
  discounts. Scalping isn't hard-banned — it forfeits loyalty and is economically
  disincentivized.
- **Identity: check-in only.** Wallets stay pseudonymous through purchase and
  resale. "Who is using the ticket" is established at the door via wallet-control
  proof (+ optional ID match), not via KYC at purchase.
- **Loyalty: soulbound attendance score.** A non-transferable, on-chain
  reputation per wallet. Earned at check-in, forfeited/penalized on flips.
- **Resale enforcement: restricted transfer + official market.** Tickets can
  only move through the official resale contract (or organizer). Private/OTC
  transfers revert, guaranteeing every resale is captured and price-checked.
- **Auctions: score-weighted (handicap) bidding.** Both primary and resale
  sales can run as auctions where loyalty tilts *who wins*: a loyal attendee's
  bid is weighted up so it can beat a higher cash bid from a no-reputation
  wallet. Available for primary and resale (resale auctions are capped).

This doc is the design only. No code yet.

## Why Monad fits

- **Full EVM bytecode compatibility** — Monad replays Ethereum mainnet history
  and matches Merkle roots, so standard Solidity, Foundry, and OpenZeppelin work
  unchanged. No custom toolchain.
- **High throughput + low fees + fast finality** make "everything on-chain"
  (every resale, every check-in, every loyalty update) economically viable where
  it would be cost-prohibitive on L1 Ethereum. On-sale spikes (thousands of mints
  in seconds) and per-attendee check-in writes are the workload Monad is built for.
- **Parallel execution** handles bursty, independent transactions (many distinct
  ticket mints/transfers) well.

## On-chain vs off-chain split

**On-chain (source of truth):**
- Ticket ownership (NFT), full transfer provenance, primary + resale settlement,
  price-cap enforcement, royalties, soulbound attendance score, check-in records.

**Off-chain (UX + data that needn't be trustless):**
- Event discovery/browsing UI, seat maps, media/metadata hosting (IPFS or
  centralized + on-chain hash), indexer (event log → queryable API), the gate app
  that scans QR/deep-link and submits the check-in tx, push notifications,
  fiat on-ramp. Reputation is *computed and stored on-chain*; off-chain only
  reads/indexes it.

## Contracts

A factory + per-event-collection pattern. Suggested Foundry layout under
`src/`:

### 1. `EventFactory.sol`
- Organizer deploys/registers an event. Creates a `TicketCollection` (ERC-721)
  per event with config: total supply per tier, face price per tier, sale
  windows, resale price cap (e.g. `faceValue` or `faceValue * (1 + capBps)`),
  royalty bps, organizer/treasury address.
- Holds the registry of events; emits `EventCreated` for the indexer.
- Owns access to the shared `LoyaltyRegistry` and `ResaleMarketplace` so a new
  event is wired to them at creation.

### 2. `TicketCollection.sol` (ERC-721, one per event)
- Mints tickets for primary sale (priced per tier; gated by presale rules — see
  Loyalty). Stores per-token: tier, original face price, mint timestamp,
  `usedAt` (check-in), `lastSalePrice`.
- **Restricted transfer enforcement.** Override the OpenZeppelin v5 transfer hook
  `_update(to, tokenId, auth)` to revert unless the transfer is initiated by an
  authorized mover: the `ResaleMarketplace`, the organizer, or `address(0)`
  mint/burn. This makes the official marketplace the *only* resale path; OTC
  wallet-to-wallet transfers revert. (Mirrors the ERC-721 transfer-restriction
  pattern; reuse OZ `ERC721`, `AccessControl`, `ReentrancyGuard`.)
- Holds the check-in entrypoint: `checkIn(tokenId, signature)` — see Check-in.
- A ticket that has been checked in (`usedAt != 0`) is non-transferable
  (resale of a used ticket reverts).

### 3. `ResaleMarketplace.sol` (shared)
- `list(collection, tokenId, price)` — seller lists; **reverts if
  `price > resaleCap`** for that collection/tier. Escrows the ticket (or uses an
  approval + atomic-settle model to avoid holding custody).
- `buy(collection, tokenId)` — pays seller, routes royalty to organizer/artist,
  transfers ticket to buyer via the privileged path, records `lastSalePrice`,
  emits `Resold(tokenId, from, to, price, timestamp)`.
- Calls `LoyaltyRegistry` to apply the resale's reputation effect (see below).
- This is the single contract authorized to move tickets, so every resale is
  captured and priced on-chain by construction.

### 4. `TicketAuction.sol` (shared)
- Sealed-or-ascending auction usable for **primary** (organizer mints the won
  ticket to the winner) and **resale** (seller's escrowed ticket; clearing
  price capped at `resaleCap`).
- **Score-weighted (handicap) bidding.** The contract ranks bids by an
  *effective bid*, not raw cash:
  `effectiveBid = bid * (1 + min(scoreBonus(score), maxBonusBps))`.
  `scoreBonus` is a monotonic function of the bidder's soulbound
  `LoyaltyRegistry` score, clamped by a per-auction `maxBonusBps` so loyalty
  tilts but never fully overrides price. A loyal attendee can win over a higher
  raw bid from a zero/negative-reputation wallet.
- **Winner pays their actual bid** (the handicap affects ranking only, not the
  amount paid) — avoids distorting settlement economics. Losing bids refunded.
- On settlement: routes payment (seller/organizer + royalty), moves the ticket
  via the privileged path (so it's captured like any other transfer), records
  `lastSalePrice`, emits `AuctionSettled(...)`. Resale auctions apply the same
  flip penalty logic as fixed-price resales.
- Reuse OZ `ReentrancyGuard`; pull-payment pattern for refunds. This is an
  authorized ticket mover alongside `ResaleMarketplace`.

### 5. `LoyaltyRegistry.sol` (shared, soulbound)
- Non-transferable per-wallet score (ERC-5192-style soulbound; not an ERC-20).
  `mapping(address => int256) score` plus history counters
  (events attended, flips, etc.).
- **Earn:** `+attendPoints` when a wallet checks in a ticket it holds (called by
  `TicketCollection.checkIn`).
- **Forfeit/penalize:** when a ticket is resold before its event via the
  marketplace, apply `-flipPenalty` to the seller (scaled by how far above face
  it sold, if cap > face). A genuine "can't attend" resale near face value costs
  little; serial high-margin flipping erodes score fast.
- **Spend/gate:** `EventFactory`/`TicketCollection` read score to gate presale
  windows and apply tiered discounts at primary mint (e.g. score thresholds →
  earlier presale access + N% off). `TicketAuction` reads score to compute the
  bid handicap. Score is read-only to all consuming contracts.
- Soulbound so reputation can't be bought/transferred — it must be earned by the
  same wallet that attends. This directly answers "who actually uses tickets."

## Anti-scalping logic (how it ties together)

1. Every ticket is an NFT with immutable provenance; resales can *only* go
   through `ResaleMarketplace`, so the platform sees and prices every hop.
2. Price cap removes the core scalper profit motive (can't resell at 5×).
3. Soulbound attendance score rewards hold-and-attend behavior with future
   presale priority + discounts; flipping forfeits it. Scalpers accumulate
   negative/low reputation and get *worse* future access — a self-reinforcing
   sorting mechanism. In **auctions**, score directly handicaps bids so loyal
   attendees win contested tickets over higher-cash flippers without overpaying.
4. Check-in binds a real attendance event to a wallet, making the score
   meaningful (a wallet that buys 50 tickets and checks in 0 is visibly a
   reseller in the on-chain data).

## Check-in (identity at the door)

- Pseudonymous until the gate. At entry, the gate app challenges the holder to
  sign a fresh nonce with the ticket-holding wallet (proves wallet control;
  no KYC). Gate submits `checkIn(tokenId, signature)`.
- `checkIn` verifies the signer owns `tokenId`, sets `usedAt`, makes the ticket
  non-transferable, and credits the holder's attendance score via
  `LoyaltyRegistry`.
- Optional ID match at the gate (off-chain, organizer policy) layered on top —
  the on-chain record only needs wallet-control proof.

## Tech stack

- **Contracts:** Solidity 0.8.x, Foundry (`forge`/`anvil`/`cast`),
  OpenZeppelin v5 (`ERC721`, `AccessControl`, `ReentrancyGuard`).
- **Indexer:** subgraph-style or a lightweight log indexer over `EventCreated`,
  `Transfer`, `Resold`, `CheckedIn`, `ScoreChanged` → Postgres → read API.
- **Frontend:** wallet connect (wagmi/viem), Monad RPC. Gate app is a mobile/web
  client that scans and submits check-in txs.
- **Metadata:** IPFS for token metadata/media; store content hash on-chain.

## Suggested repo layout (when we build)

```
/contracts        Foundry project (src/, test/, script/)
  src/EventFactory.sol
  src/TicketCollection.sol
  src/ResaleMarketplace.sol
  src/TicketAuction.sol
  src/LoyaltyRegistry.sol
  test/            forge tests (see verification)
  script/Deploy.s.sol
/indexer           log indexer + read API
/web               buyer/organizer frontend
/gate              check-in app
```

## Verification (when implemented)

- **Unit/invariant tests (Foundry):**
  - OTC transfer reverts; transfer via `ResaleMarketplace` succeeds.
  - `list` reverts above resale cap; succeeds at/below cap.
  - `buy` pays seller, routes royalty, records `lastSalePrice`, emits `Resold`.
  - Reselling a checked-in ticket reverts.
  - `checkIn` rejects wrong signer / replayed nonce; credits score once.
  - Loyalty: attendance increments, flip decrements; score gates presale access
    and applies discount thresholds correctly.
  - Soulbound: score cannot be transferred.
  - Auction: higher raw bid loses to a lower bid from a sufficiently
    higher-score wallet (handicap works); bonus is clamped at `maxBonusBps`;
    winner pays their actual bid, not the handicapped figure; losing bids fully
    refundable; resale-auction clearing price cannot exceed `resaleCap`.
- **Local e2e on `anvil`:** deploy via `script/Deploy.s.sol`, run a full
  lifecycle with `cast` — create event → presale-gated mint → list → buy
  (capped) → run a score-weighted auction with two bidders (loyal lower bid vs
  flipper higher bid) and assert the loyal wallet wins → check-in → assert score
  change → attempt OTC transfer (expect revert).
- **Monad testnet:** deploy and replay the same lifecycle against a real RPC;
  measure gas/cost per mint, resale, and check-in to confirm on-chain-everything
  is economical at expected on-sale volumes.

## Open questions to revisit during build

- Resale cap exactly at face, or face + small bps to allow a fair secondary?
- Escrow-on-list vs approval + atomic settle (UX vs custody risk).
- Exact score curve: attendance reward, flip penalty scaling, presale tier
  thresholds, discount sizes.
- Auction format (sealed-bid vs ascending/English vs Dutch), `scoreBonus`
  shape and `maxBonusBps` ceiling, and anti-sniping (auto-extend) rules.
- Refund/cancellation flow if an event is cancelled (organizer buyback path).

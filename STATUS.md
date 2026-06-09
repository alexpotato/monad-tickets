# Build Status — On-Chain Ticketing on Monad

Last updated: 2026-06-09.

## What exists

A working Foundry project under `contracts/` implementing the full design in
[ARCHITECTURE.md](./ARCHITECTURE.md). All five contracts are implemented, 22
tests pass, and the deploy script runs against a live anvil node.

```
contracts/
  src/
    LoyaltyRegistry.sol        soulbound per-wallet reputation
    TicketCollection.sol       ERC-721 per event, restricted transfer + check-in
    ResaleMarketplace.sol      capped fixed-price resale, royalty, flip penalty
    TicketAuction.sol          score-weighted auction (primary + resale)
    EventFactory.sol           deploys + wires per-event collections
    interfaces/
      ILoyaltyRegistry.sol
      ITicketCollection.sol
  test/
    Base.t.sol                 shared deploy + helpers (signing, mint)
    LoyaltyRegistry.t.sol      4 tests
    TicketCollection.t.sol     7 tests
    ResaleMarketplace.t.sol    4 tests
    TicketAuction.t.sol        6 tests
    E2E.t.sol                  1 full-lifecycle test
  script/Deploy.s.sol
  foundry.toml                 solc 0.8.28, via_ir=true, OZ v5.1.0 remapped
```

## Commands

```bash
cd contracts
forge build
forge test                                    # 22 tests, all passing
forge test --match-path test/E2E.t.sol -vv    # full lifecycle

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
- **Check-in** verifies an `eth_sign`-style signature: digest =
  `toEthSignedMessageHash(keccak256(abi.encode(collection, chainid, tokenId, nonce)))`,
  recovered signer must equal `ownerOf(tokenId)`. Per-holder `checkInNonce`
  gives replay protection. Submitted by a `GATE_ROLE` address.
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

## Not yet built (per ARCHITECTURE.md)

- Presale gating + tiered discounts at primary mint (registry read surface
  exists; the gating logic in `TicketCollection.mintTo` is not wired yet —
  `mintTo` currently takes an explicit price).
- Indexer (`/indexer`), frontend (`/web`), gate app (`/gate`).
- Metadata / tokenURI (no IPFS hookup yet).
- Event-cancellation / refund buyback flow.
- Anti-sniping auto-extend on auctions.

## Open design questions (unchanged from ARCHITECTURE.md)

- Resale cap exactly at face vs face + bps.
- Sealed-bid vs ascending vs Dutch auction format.
- Exact score curve (attendance reward, flip penalty scaling, presale
  thresholds, discount sizes).

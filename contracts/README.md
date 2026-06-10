# On-Chain Ticketing on Monad

A Ticketmaster-style ticketing system where **every resale happens on-chain**,
so the platform can distinguish genuine attendees from scalpers — and reward the
former rather than merely punishing the latter.

Monad is fully EVM-bytecode-compatible, so these are standard Solidity contracts
(Foundry + OpenZeppelin v5). Monad's throughput, low fees, and fast finality are
what make "everything on-chain" (every resale, every check-in, every loyalty
update) economical at on-sale volumes.

## Contracts

| Contract | Role |
| --- | --- |
| `LoyaltyRegistry` | Soulbound, non-transferable per-wallet reputation. Earned at check-in, forfeited on flips. Read by primary sale, resale, and auctions. |
| `TicketCollection` | One ERC-721 per event. Restricted transfer (only the official market/auction can move tickets — OTC transfers revert). Holds check-in. |
| `ResaleMarketplace` | The only fixed-price resale path. Price-capped, routes royalty, applies flip penalty. |
| `TicketAuction` | Score-weighted auctions for primary + resale. Loyalty handicaps bids so loyal attendees can win over higher cash bids; winner pays their actual bid. |
| `AttendanceStub` | Soulbound souvenir minted at check-in when the ticket is handed back to the event wallet. Permanent proof-of-attendance (POAP-style). |
| `EventFactory` | Deploys per-event collections wired to the shared registry/stub/market/auction. |

## Anti-scalping mechanism

1. Tickets are NFTs with full provenance; resales can **only** go through the
   official market/auction (`_update` reverts otherwise), so every hop is
   captured and price-checked.
2. **Price cap** removes the scalper profit motive.
3. **Soulbound attendance score** rewards hold-and-attend (presale priority +
   discounts) and is forfeited by flipping. In auctions, score directly
   handicaps bids.
4. **Check-in is a ticket swap** that binds real attendance to a wallet: the
   attendee types the venue's rotating code (bound into their signature — code
   knowledge + wallet control in one), the gate submits and pays gas (free for
   the attendee), the ticket transfers back to the event wallet (the canonical
   attendance record — a used ticket can't be reused or resold), and a
   soulbound stub + loyalty credit go to the attendee. No KYC.

## Build / test / deploy

```bash
forge build
forge test                                    # 29 tests
forge test --match-path test/E2E.t.sol -vv    # full lifecycle

# Deploy (anvil or Monad testnet)
anvil &
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

## Design notes / open questions

- Resale auctions are capped at the collection's `resaleCap`; primary auctions
  are reserve-only.
- Flip penalty = base + a margin component (more above face → larger hit).
- Auction is a first-price ascending model: each bid escrows funds, outbid
  deposits are withdrawable via `withdrawRefund`, winner pays their own bid.
- Open: sealed-bid vs ascending vs Dutch; anti-sniping auto-extend; exact score
  curve and discount thresholds; event-cancellation buyback flow.

See `~/.claude/plans/wise-growing-map.md` for the full architecture.

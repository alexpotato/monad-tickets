# Project: On-Chain Ticketing on Monad

A Ticketmaster-style ticketing platform on Monad where every resale happens
on-chain, to distinguish genuine attendees from scalpers and reward the former.

## Read these first

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — full design: locked decisions,
  contracts, anti-scalping logic, check-in flow, open questions. Read this to
  understand *why* the system is shaped the way it is.
- **[STATUS.md](./STATUS.md)** — current build state: what's implemented,
  implementation facts/decisions made during coding, what's not built yet, and
  the exact build/test/deploy commands. Read this to know *where things stand*.

## Quick orientation

Code lives in `contracts/` (Foundry, Solidity 0.8.28 + `via_ir`, OpenZeppelin
v5.1.0). Six contracts: `LoyaltyRegistry`, `AttendanceStub`,
`TicketCollection`, `ResaleMarketplace`, `TicketAuction`, `EventFactory`.
33 passing tests. A demo web app lives in `web/` (Vite + React + viem):
organizer dashboard, attendee phone simulator, and venue gate — see
`web/README.md` for the run book.

```bash
cd contracts && forge test
cd web && npm run e2e   # headless demo-flow check (needs seeded anvil)
```

The locked product decisions: hybrid-loyalty resale (capped + soulbound
reputation), check-in-only identity (signature, no KYC), restricted transfer
(official market is the only resale path), score-weighted auctions (loyalty
handicaps bids; winner pays their own bid), and ticket-swap check-in (attendee
types a rotating venue code, gate pays gas, ticket returns to the event wallet,
soulbound souvenir stub minted to the attendee).

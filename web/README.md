# Monad Tickets — Demo Web App / PWA

**Hosted PWA:** https://alexpotato.github.io/monad-tickets/ — open on a phone and
"Add to Home Screen" to install. Defaults to the Monad testnet profile (see
[TESTNET.md](../TESTNET.md) for the deploy runbook) with an in-app switcher
for local anvil.

Three-surface simulator for the on-chain ticketing system: an **organizer
dashboard** (list seats, watch sales/check-ins), an **attendee phone simulator**
(buy seats, hold tickets, check in), and a **venue gate** (rotating code +
scanner). All actions are real transactions against a local anvil chain.

## Run it

```bash
# 1. Local chain
anvil

# 2. Deploy + seed (event "Monad Live: Block Party", 30 seats)
cd contracts
forge script script/Demo.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# 3. Web app
cd ../web
npm install
npm run dev     # open http://localhost:5173
```

The default URL is the wallet app (attendee). Operator surfaces have their
own URLs: `#/admin` (organizer dashboard), `#/gate` (venue gate), and `#/demo`
(all three side by side). The dev server binds to the network (`--host`), so a
phone on the same LAN can open `http://<your-ip>:5173`.

## Demo walkthrough

1. **Organizer pane** — see the seat map live from chain; list extra rows.
2. **Attendee phone** — pick a persona (Ava/Ben/Cleo — anvil accounts), buy a
   seat (mints the ticket NFT), see it under *Tickets*.
3. **Gate pane** — press *Rotate venue code*: a code like `MOSH-7421` appears
   (its hash is committed on-chain; the plaintext is what venue screens show).
4. **Attendee phone** — open the ticket, type the venue code, press *Sign &
   present*. The phone signs (no transaction, no gas) and "presents the QR".
5. **Gate pane** — the scanner receives the pass and submits `checkIn` paying
   the gas. Watch: ticket returns to the event wallet, a soulbound stub lands
   in the attendee's *Profile*, loyalty score +10.
6. Try typing a wrong code — the gate rejects it (`bad holder signature` /
   `BadGateCode`), demonstrating the binding.

## Headless verification

```bash
npm run e2e   # drives the same viem calls the UI makes, asserts all outcomes
```

## Notes

- Personas are anvil's well-known accounts (organizer #1, gate #2,
  attendees #3–5) — no wallet extension needed; this is a simulation harness.
- The QR hand-off is simulated with a BroadcastChannel, so it works between
  panes on one page and across browser tabs.
- The factory address in `src/lib/chain.ts` is deterministic for a fresh anvil
  node seeded by `Demo.s.sol`. Restart anvil → re-run the seed → reload.

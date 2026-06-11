# Monad Testnet Runbook

Takes the demo from local anvil to Monad testnet so the hosted PWA
(https://alexpotato.github.io/monad-tickets/) works from any phone.

Chain: **Monad testnet**, chain id `10143`, RPC `https://testnet-rpc.monad.xyz`,
explorer `https://testnet.monadexplorer.com`, faucet `https://faucet.monad.xyz`.

## 1. Fund three addresses

| Role | Address | Needs |
| --- | --- | --- |
| Deployer (your key) | whatever `PRIVATE_KEY` you use | ~0.5 MON (contract deploys) |
| Shared organizer | `0x4FcFba4127025B2565C0eB7BE6bcEF381D36F4bC` | ~0.2 MON (creates event, lists seats) |
| Shared gate | `0xaDdB5c3D8CB297dfe3A10DdF275c2f3e6a40E9d4` | ~0.2 MON (code rotations + check-ins; top up as it drains) |

The organizer/gate private keys are intentionally committed
(`web/src/lib/profiles.ts`, `contracts/script/DeployTestnet.s.sol`) — they are
shared demo roles on a valueless testnet, same spirit as anvil's dev keys.
Don't send them anything you care about.

## 2. Deploy + seed

```bash
cd contracts
PRIVATE_KEY=0x<your-funded-deployer-key> \
  forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

The script deploys the six contracts, wires roles, creates "Monad Live: Block
Party" with a 30-seat map (0.01 / 0.006 MON seats), and prints the
**EventFactory address**.

## 3. Point the PWA at it

In `web/src/lib/profiles.ts`, set the testnet profile's factory:

```ts
factory: "0x<EventFactory address from step 2>",
```

Commit and push — the Pages workflow rebuilds and the hosted PWA goes live
against testnet automatically.

## 4. Test from a phone

1. Open https://alexpotato.github.io/monad-tickets/ on the phone — it defaults
   to the Monad testnet profile and the attendee view.
2. Install it: Share → "Add to Home Screen" (iOS) or the install prompt
   (Android).
3. The app generates a per-device wallet. Send it a little MON (the faucet
   banner shows the address with tap-to-copy) — only needed for buying seats;
   check-in is gasless for the attendee.
4. On a laptop, open the same URL with `#/gate` for the gate screen and
   `#/organizer` for the dashboard (shared demo roles, no setup), rotate the
   venue code, and run a real phone-to-gate check-in.

## Funding phone wallets

Each device that opens the PWA generates its own wallet (address shown in the
app's faucet banner, tap to copy). Fund it with:

```bash
cd web
npm run fund -- 0xPHONE_ADDRESS            # 2 MON default
npm run fund -- 0xA... 0xB... --amount 5   # several at once
```

The script sends from the deployer/distributor wallet and automatically tops
itself up from the team faucet when low. Faucet URL + credentials live in the
repo-root `.env` (gitignored):

```
TESTNET_DEPLOYER_PK=0x...
FAUCET_URL=.../faucet/request
FAUCET_USER=...
FAUCET_PASS=...
```

## Notes

- Attendee check-in stays free on testnet: the shared gate key submits and
  pays, exactly like the local demo.
- If the gate key runs dry, send it more MON — the gate pane will start
  failing rotations/check-ins with an out-of-funds error otherwise.
- The local anvil profile keeps working unchanged; the in-app switcher (top
  right) toggles between chains.

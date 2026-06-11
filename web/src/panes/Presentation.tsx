import { useEffect, useState } from "react";
import { type Address } from "viem";
import {
  POLL_MS,
  loadStubs,
  loyaltyAbi,
  publicClient,
  PROFILE,
  type EventState,
} from "../lib/chain";
import { usePoll } from "../lib/hooks";

/// Slide deck at #/presentation: why attendance — not purchase — is the
/// signal that separates fans from scalpers, and how this system makes it
/// a chain-native primitive. One slide renders live chain data.
export function Presentation({ state }: { state?: EventState }) {
  const [i, setI] = useState(0);

  const slides = buildSlides(state);
  const n = slides.length;
  const go = (d: number) => setI((cur) => Math.min(n - 1, Math.max(0, cur + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") go(1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(-1);
      if (e.key === "Escape") window.location.hash = "#/demo";
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  return (
    <div className="deck">
      <div
        className="deck-click left"
        onClick={() => go(-1)}
        title="Previous (←)"
      />
      <div
        className="deck-click right"
        onClick={() => go(1)}
        title="Next (→ or space)"
      />
      <a className="deck-exit" href="#/demo" title="Exit (Esc)">✕</a>
      <div className="slide">{slides[i]}</div>
      <div className="deck-dots">
        {slides.map((_, k) => (
          <i key={k} className={k === i ? "on" : ""} onClick={() => setI(k)} />
        ))}
      </div>
      <div className="deck-pos">{i + 1} / {n}</div>
    </div>
  );
}

function buildSlides(state?: EventState) {
  return [
    // 1 — title
    <section key="t" className="center">
      <div className="kicker">LIVE ON MONAD TESTNET</div>
      <h1>⛓ Monad Tickets</h1>
      <p className="big">
        Ticketing that knows the difference between a <em>fan</em> and a <em>flipper</em> —
        because attendance lives on-chain.
      </p>
    </section>,

    // 2 — the problem
    <section key="p">
      <h2>The scalper problem</h2>
      <ul>
        <li>Bots clear an on-sale in seconds; fans pay <strong>5–10×</strong> on secondary.</li>
        <li>None of the markup reaches the artist or organizer.</li>
        <li>At purchase time, a scalper's money looks exactly like a fan's money.</li>
        <li>KYC at checkout is invasive, full of friction — and bots beat it anyway.</li>
      </ul>
    </section>,

    // 3 — the blind spot
    <section key="b" className="center">
      <h2>Every ticketing system sees the purchase.</h2>
      <p className="big">
        Almost none see the <em>attendance</em>.
      </p>
      <p className="big accent">
        But "did this buyer walk through the door?" is the one signal a scalper
        can never fake at scale.
      </p>
    </section>,

    // 4 — make attendance the primitive
    <section key="a">
      <h2>Make attendance the primitive</h2>
      <ul>
        <li>Every ticket is an NFT with full provenance.</li>
        <li>
          Resale <strong>only</strong> through the official on-chain market — peer-to-peer
          transfers revert, so every hop is captured and price-capped.
        </li>
        <li>
          Check-in is a <strong>ticket swap</strong>: the ticket returns to the event wallet,
          the fan receives a <strong>soulbound stub</strong> — permanent, untransferable proof
          they were there.
        </li>
        <li>The chain itself becomes the attendance ledger. No accounts. No tracking.</li>
      </ul>
    </section>,

    // 5 — check-in mechanics
    <section key="c">
      <h2>Proving presence without KYC</h2>
      <ol>
        <li>Venue screens show a rotating code (hash committed on-chain).</li>
        <li>The fan types it; it's bound into <strong>one signature</strong> with their tickets.</li>
        <li>The gate submits and pays the gas — <strong>check-in is free for fans</strong>.</li>
        <li>Ticket → event wallet. Stub → fan. Loyalty +10. All in one transaction.</li>
      </ol>
      <p className="sub2">Pseudonymous, yet cryptographically attributable. Wallet control + code knowledge + gate co-attestation.</p>
    </section>,

    // 6 — the flywheel
    <section key="f">
      <h2>The loyalty flywheel</h2>
      <ul>
        <li><strong>Attend</strong> → soulbound score rises → presale priority next time.</li>
        <li>
          In auctions, loyalty <strong>handicaps bids</strong>: a fan's 0.95 beats a
          zero-history 1.00 — and the fan still pays only their own bid.
        </li>
        <li><strong>Flip</strong> → penalty scaled by markup. Sell at face because life happens: tiny cost. Flip serially at the cap: reputation bleeds out.</li>
        <li>Reputation can't be bought or transferred. Only earned by showing up.</li>
      </ul>
    </section>,

    // 7 — resale, civilized
    <section key="r">
      <h2>Resale, civilized — not banned</h2>
      <ul>
        <li>Price-capped (face +20%) — the scalper margin disappears.</li>
        <li>Royalties to the organizer on every hop.</li>
        <li>Every transfer priced and recorded by construction.</li>
        <li>A used ticket can't be resold — the attendee no longer owns it.</li>
      </ul>
    </section>,

    // 8 — live data
    <section key="l">
      <h2>The receipts — live from chain, right now</h2>
      <LiveRoster state={state} />
      <p className="sub2">
        This table is real Monad testnet state, read while you watch. The 8-ticket /
        zero-stub wallet is how a reseller looks from orbit.
      </p>
    </section>,

    // 9 — why monad
    <section key="m">
      <h2>Why Monad</h2>
      <ul>
        <li>Every sale, resale, check-in, and loyalty update is its own transaction — that takes <strong>throughput</strong>.</li>
        <li>Sub-cent fees make per-attendee on-chain writes economical.</li>
        <li>Sub-second finality means the gate line actually moves.</li>
        <li>This entire system runs on public testnet today, from a PWA, with <strong>zero backend</strong>.</li>
      </ul>
    </section>,

    // 10 — try it
    <section key="x" className="center">
      <h2>Try it now</h2>
      <p className="big mono2">alexpotato.github.io/monad-tickets</p>
      <p className="big">
        📱 Wallet app at the root · <span className="mono2">#/admin</span> ·{" "}
        <span className="mono2">#/gate</span> · <span className="mono2">#/company</span>
      </p>
      <p className="sub2">github.com/alexpotato/monad-tickets — contracts, PWA, and every test</p>
    </section>,
  ];
}

function LiveRoster({ state }: { state?: EventState }) {
  const [rows] = usePoll(async () => {
    if (!state) return undefined;
    const stubs = await loadStubs(state.stub);
    const stubsBy = new Map<string, number>();
    for (const s of stubs) {
      stubsBy.set(s.owner.toLowerCase(), (stubsBy.get(s.owner.toLowerCase()) ?? 0) + 1);
    }
    const holdingBy = new Map<string, number>();
    for (const s of state.seats) {
      if (s.tokenId !== 0n && !s.used && s.owner) {
        holdingBy.set(s.owner.toLowerCase(), (holdingBy.get(s.owner.toLowerCase()) ?? 0) + 1);
      }
    }
    const wallets = [...new Set([...stubsBy.keys(), ...holdingBy.keys()])] as Address[];
    if (wallets.length === 0) return [];
    const calls = wallets.map((w) => ({
      address: state.loyalty,
      abi: loyaltyAbi,
      functionName: "scoreOf",
      args: [w],
    }));
    const scores: bigint[] = PROFILE.chain.contracts?.multicall3
      ? ((await publicClient.multicall({ contracts: calls as never, allowFailure: false })) as bigint[])
      : await Promise.all(calls.map((c) => publicClient.readContract(c as never) as Promise<bigint>));
    return wallets
      .map((wallet, i) => ({
        wallet,
        stubs: stubsBy.get(wallet.toLowerCase()) ?? 0,
        holding: holdingBy.get(wallet.toLowerCase()) ?? 0,
        score: scores[i],
      }))
      .sort((a, b) => b.stubs - a.stubs || Number(b.score - a.score));
  }, POLL_MS);

  if (!state) return <p className="sub2">Connecting to chain…</p>;
  if (rows === undefined) return <p className="sub2">Reading chain…</p>;
  if (rows.length === 0) return <p className="sub2">No audience yet — go buy a seat!</p>;

  return (
    <table className="rostr deck-table">
      <thead>
        <tr><th>Wallet</th><th>Holding</th><th>Attended</th><th>Loyalty</th><th>Verdict</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.wallet}>
            <td className="mono">{r.wallet.slice(0, 8)}…{r.wallet.slice(-4)}</td>
            <td>{r.holding || "—"}</td>
            <td>{r.stubs ? `🎟 ${r.stubs}` : "—"}</td>
            <td>{r.score.toString()}</td>
            <td>
              {r.stubs > 0
                ? "✓ fan"
                : r.holding >= 4
                  ? "⚠ reseller pattern"
                  : "holding"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

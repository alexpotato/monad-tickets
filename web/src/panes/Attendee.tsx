import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import {
  PERSONAS,
  PROFILE,
  POLL_MS,
  autoFundIfPossible,
  collectionAbi,
  loadStubs,
  loyaltyAbi,
  stubAbi,
  batchCheckInDigest,
  publicClient,
  walletFor,
  type EventState,
} from "../lib/chain";
import { presentToGate, onResult } from "../lib/bus";
import { usePoll } from "../lib/hooks";
import { shortError } from "./Organizer";

type Tab = "seats" | "tickets" | "profile";

export function Attendee({ state, refresh }: { state: EventState; refresh: () => void }) {
  const [personaIdx, setPersonaIdx] = useState(0);
  const [tab, setTab] = useState<Tab>("seats");
  const persona = PERSONAS.attendees[personaIdx];
  const { account, client } = useMemo(() => walletFor(persona.key), [persona.key]);

  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Multi-select state: a cart of seat labels to buy, and the set of held
  // tickets selected for check-in. Both reset when switching persona.
  const [cart, setCart] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [code, setCode] = useState("");
  useEffect(() => {
    setCart(new Set());
    setPicked(new Set());
    setMsg(null);
  }, [persona.key]);

  const [profile] = usePoll(async () => {
    const [balance, score, stubCount] = await Promise.all([
      publicClient.getBalance({ address: account.address }),
      publicClient.readContract({
        address: state.loyalty, abi: loyaltyAbi, functionName: "scoreOf", args: [account.address],
      }),
      publicClient.readContract({
        address: state.stub, abi: stubAbi, functionName: "balanceOf", args: [account.address],
      }),
    ]);
    return { balance, score, stubCount };
  }, POLL_MS);

  // Show gate results on the phone (success or rejection at the door).
  useEffect(
    () =>
      onResult((r) => {
        setMsg({ kind: r.ok ? "ok" : "err", text: r.message });
        refresh(); // gate settled on-chain — show the outcome immediately
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A freshly-generated device wallet has zero balance. On anvil, conjure
  // funds automatically; on testnet, the faucet banner below takes over.
  useEffect(() => {
    if (profile?.balance === 0n && PROFILE.canAutoFund) {
      autoFundIfPossible(account.address);
    }
  }, [profile?.balance, account.address]);

  const needsFunds = profile?.balance === 0n && !PROFILE.canAutoFund;
  const [funding, setFunding] = useState(false);

  // "Get funds": the shared demo sponsor (a pre-funded, intentionally public
  // testnet key, same spirit as the gate/organizer roles) sends the device
  // wallet a couple of MON — signed entirely client-side, no backend.
  async function getFunds() {
    const sponsor = PROFILE.roles.sponsor;
    if (!sponsor) return;
    setFunding(true);
    setMsg(null);
    try {
      const { client: sponsorClient } = walletFor(sponsor.key);
      const hash = await sponsorClient.sendTransaction({
        to: account.address,
        value: parseEther("2"),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      refresh();
      setMsg({ kind: "ok", text: "2 MON sent by the demo sponsor — happy seat shopping!" });
    } catch (e) {
      setMsg({ kind: "err", text: `Sponsor transfer failed: ${shortError(e)}` });
    } finally {
      setFunding(false);
    }
  }

  const myTickets = state.seats.filter(
    (s) => s.tokenId !== 0n && s.owner?.toLowerCase() === account.address.toLowerCase() && !s.used,
  );
  const pickedTickets = myTickets.filter((s) => picked.has(s.label));
  const cartSeats = state.seats.filter((s) => cart.has(s.label) && s.tokenId === 0n);
  const cartTotal = cartSeats.reduce((acc, s) => acc + s.price, 0n);

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, label: string) {
    const next = new Set(set);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setter(next);
  }

  async function buyCart() {
    setBusy(true);
    setMsg(null);
    try {
      const labels = cartSeats.map((s) => s.label);
      const hash = await client.writeContract({
        address: state.collection,
        abi: collectionAbi,
        functionName: "buySeats",
        args: [labels],
        value: cartTotal,
      });
      await publicClient.waitForTransactionReceipt({ hash });
      refresh(); // mined — pull the new tickets into view right away
      setMsg({
        kind: "ok",
        text: `${labels.length} seat${labels.length > 1 ? "s" : ""} minted: ${labels.join(", ")}`,
      });
      setCart(new Set());
      setTab("tickets");
    } catch (e) {
      setMsg({ kind: "err", text: shortError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function checkInPicked() {
    setBusy(true);
    setMsg(null);
    try {
      const ids = pickedTickets.map((s) => s.tokenId);
      const nonce = await publicClient.readContract({
        address: state.collection,
        abi: collectionAbi,
        functionName: "checkInNonce",
        args: [account.address],
      });
      // One signature covers the whole token list + the typed venue code.
      const digest = batchCheckInDigest(state.collection, ids, nonce, code.trim());
      const sig = await account.signMessage({ message: { raw: digest } });
      presentToGate({
        tokenIds: ids.map(String),
        code: code.trim(),
        sig,
        holder: account.address,
        seats: pickedTickets.map((s) => s.label).join(", "),
      });
      setMsg({
        kind: "info",
        text: `Pass for ${pickedTickets.length} ticket(s) presented to the gate — waiting for scan…`,
      });
      setPicked(new Set());
      setCode("");
    } catch (e) {
      setMsg({ kind: "err", text: shortError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="phone">
      <div className="notch" />
      <div className="screen">
        <div className="persona">
          {PERSONAS.attendees.length > 1 ? (
            // Multiple demo personas only exist on local anvil; a real phone
            // just IS its wallet — no dropdown to confuse the consumer view.
            <select value={personaIdx} onChange={(e) => setPersonaIdx(Number(e.target.value))}>
              {PERSONAS.attendees.map((p, i) => (
                <option key={p.name} value={i}>{p.name}</option>
              ))}
            </select>
          ) : (
            <span style={{ flex: 1, fontWeight: 600 }}>🎫 My wallet</span>
          )}
          <span className="balance">
            {profile ? `${Number(formatEther(profile.balance)).toFixed(2)} MON` : "…"}
          </span>
        </div>

        <div className="phonetabs">
          <button className={tab === "seats" ? "active" : ""} onClick={() => setTab("seats")}>Buy seats</button>
          <button className={tab === "tickets" ? "active" : ""} onClick={() => setTab("tickets")}>
            Tickets{myTickets.length ? ` (${myTickets.length})` : ""}
          </button>
          <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>Profile</button>
        </div>

        {needsFunds && (
          <div className="msg info">
            {PROFILE.roles.sponsor ? (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  This wallet needs a little testnet MON to buy seats (check-in is free).
                </p>
                <button className="primary" onClick={getFunds} disabled={funding}>
                  {funding ? "Sending…" : "Get 2 MON (free, from the demo sponsor)"}
                </button>
              </>
            ) : (
              <>
                This wallet needs testnet MON to buy seats. Send some to{" "}
                <span
                  className="mono"
                  style={{ cursor: "pointer", textDecoration: "underline" }}
                  title="Tap to copy"
                  onClick={() => navigator.clipboard.writeText(account.address)}
                >
                  {account.address.slice(0, 10)}…{account.address.slice(-6)}
                </span>
                . Check-in itself is free.
              </>
            )}
          </div>
        )}

        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

        {tab === "seats" && (
          <div className="card">
            <h2>{state.name}</h2>
            <p className="sub">Tap seats to add them to your order.</p>
            <div className="seatgrid">
              {state.seats.map((s) => {
                const mine = s.owner?.toLowerCase() === account.address.toLowerCase();
                const inCart = cart.has(s.label);
                return (
                  <button
                    key={s.label}
                    className={`seat ${s.used ? "used" : mine ? "mine" : s.tokenId !== 0n ? "sold" : inCart ? "sel" : ""}`}
                    disabled={busy || s.tokenId !== 0n}
                    onClick={() => toggle(cart, setCart, s.label)}
                  >
                    {s.label}
                    <span className="price">
                      {s.tokenId === 0n
                        ? inCart
                          ? "✓ added"
                          : formatEther(s.price)
                        : mine
                          ? "yours"
                          : "sold"}
                    </span>
                  </button>
                );
              })}
            </div>
            <div style={{ marginTop: 12 }}>
              <button className="primary" onClick={buyCart} disabled={busy || cartSeats.length === 0}>
                {busy
                  ? "Buying…"
                  : cartSeats.length === 0
                    ? "Select seats to buy"
                    : `Buy ${cartSeats.length} seat${cartSeats.length > 1 ? "s" : ""} — ${formatEther(cartTotal)} MON (one tx)`}
              </button>
            </div>
          </div>
        )}

        {tab === "tickets" && (
          <div>
            {myTickets.length === 0 && (
              <div className="card"><p className="sub">No active tickets. Grab a seat!</p></div>
            )}
            {myTickets.length > 0 && (
              <div className="card">
                <h4>Check in</h4>
                <p className="sub">
                  Select tickets, type the venue code once, sign once — the gate pays the gas.
                </p>
                <div className="formrow">
                  <input
                    value={code}
                    placeholder="Venue code (e.g. MOSH-7421)"
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="primary"
                    onClick={checkInPicked}
                    disabled={busy || pickedTickets.length === 0 || code.length < 4}
                  >
                    {pickedTickets.length === 0
                      ? "Select tickets below"
                      : code.length < 4
                        ? "Type the venue code"
                        : `Sign & present ${pickedTickets.length} ticket${pickedTickets.length > 1 ? "s" : ""} (one signature)`}
                  </button>
                </div>
              </div>
            )}
            {myTickets.map((s) => {
              const isPicked = picked.has(s.label);
              return (
                <div
                  key={s.label}
                  className="tickpass"
                  style={{
                    cursor: "pointer",
                    outline: isPicked ? "2px solid var(--good)" : "none",
                  }}
                  onClick={() => toggle(picked, setPicked, s.label)}
                >
                  <div className="sub">
                    {state.name} {isPicked ? "· ✓ selected for check-in" : "· tap to select"}
                  </div>
                  <div className="seatbig">Seat {s.label}</div>
                  <div className="sub">
                    Tier {s.tier} · face {formatEther(s.price)} MON · token #{s.tokenId.toString()}
                  </div>
                  <div className="qrish" title="Simulated QR — presented to the gate scanner" />
                </div>
              );
            })}
          </div>
        )}

        {tab === "profile" && (
          <Profile
            state={state}
            address={account.address}
            score={profile?.score}
            stubCount={profile?.stubCount}
          />
        )}
      </div>
    </div>
  );
}

function Profile({
  state,
  address,
  score,
  stubCount,
}: {
  state: EventState;
  address: `0x${string}`;
  score?: bigint;
  stubCount?: bigint;
}) {
  const [stubs] = usePoll(async () => {
    const all = await loadStubs(state.stub);
    return all.filter((s) => s.owner.toLowerCase() === address.toLowerCase());
  }, POLL_MS);

  return (
    <div>
      <div className="card">
        <h2>Loyalty</h2>
        <div className="statrow">
          <div className="stat">
            <div className="v">{score !== undefined ? score.toString() : "…"}</div>
            <div className="l">Attendance score</div>
          </div>
          <div className="stat">
            <div className="v">{stubCount !== undefined ? stubCount.toString() : "…"}</div>
            <div className="l">Stubs earned</div>
          </div>
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          Attend events → score rises → presale priority &amp; auction handicap. Flip tickets →
          score drops. Soulbound: it can't be bought.
        </p>
      </div>
      {(stubs ?? []).map((s) => (
        <div className="tickpass" key={s.stubId.toString()}>
          <div className="seatbig">🎟 Stub #{s.stubId.toString()}</div>
          <div className="sub">
            {state.name} · ticket #{s.ticketId.toString()} · soulbound proof you were there
          </div>
        </div>
      ))}
      <p className="mono" style={{ padding: "0 4px" }}>{address}</p>
    </div>
  );
}


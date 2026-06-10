import { useEffect, useMemo, useState } from "react";
import { formatEther } from "viem";
import {
  PERSONAS,
  collectionAbi,
  loyaltyAbi,
  stubAbi,
  checkInDigest,
  publicClient,
  walletFor,
  type EventState,
  type Seat,
} from "../lib/chain";
import { presentToGate, onResult } from "../lib/bus";
import { usePoll } from "../lib/hooks";
import { shortError } from "./Organizer";

type Tab = "seats" | "tickets" | "profile";

export function Attendee({ state }: { state: EventState }) {
  const [personaIdx, setPersonaIdx] = useState(0);
  const [tab, setTab] = useState<Tab>("seats");
  const persona = PERSONAS.attendees[personaIdx];
  const { account, client } = useMemo(() => walletFor(persona.key), [persona.key]);

  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

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
  });

  // Show gate results on the phone (success or rejection at the door).
  useEffect(
    () =>
      onResult((r) =>
        setMsg({ kind: r.ok ? "ok" : "err", text: r.message }),
      ),
    [],
  );

  const myTickets = state.seats.filter(
    (s) => s.tokenId !== 0n && s.owner?.toLowerCase() === account.address.toLowerCase() && !s.used,
  );

  async function buy(seat: Seat) {
    setBusy(true);
    setMsg(null);
    try {
      await client.writeContract({
        address: state.collection,
        abi: collectionAbi,
        functionName: "buySeat",
        args: [seat.label],
        value: seat.price,
      });
      setMsg({ kind: "ok", text: `Seat ${seat.label} is yours — minted on-chain.` });
      setTab("tickets");
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
          <select value={personaIdx} onChange={(e) => setPersonaIdx(Number(e.target.value))}>
            {PERSONAS.attendees.map((p, i) => (
              <option key={p.name} value={i}>{p.name}</option>
            ))}
          </select>
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

        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

        {tab === "seats" && (
          <div className="card">
            <h2>{state.name}</h2>
            <p className="sub">Pick a seat — purchase mints your ticket NFT.</p>
            <div className="seatgrid">
              {state.seats.map((s) => {
                const mine = s.owner?.toLowerCase() === account.address.toLowerCase();
                return (
                  <button
                    key={s.label}
                    className={`seat ${s.used ? "used" : mine ? "mine" : s.tokenId !== 0n ? "sold" : ""}`}
                    disabled={busy || s.tokenId !== 0n}
                    onClick={() => buy(s)}
                  >
                    {s.label}
                    <span className="price">
                      {s.tokenId === 0n ? formatEther(s.price) : mine ? "yours" : "sold"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === "tickets" && (
          <div>
            {myTickets.length === 0 && (
              <div className="card"><p className="sub">No active tickets. Grab a seat!</p></div>
            )}
            {myTickets.map((s) => (
              <TicketPass
                key={s.label}
                seat={s}
                state={state}
                holderKey={persona.key}
                onInfo={(text) => setMsg({ kind: "info", text })}
              />
            ))}
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

function TicketPass({
  seat,
  state,
  holderKey,
  onInfo,
}: {
  seat: Seat;
  state: EventState;
  holderKey: `0x${string}`;
  onInfo: (text: string) => void;
}) {
  const [code, setCode] = useState("");
  const [presenting, setPresenting] = useState(false);

  async function checkIn() {
    setPresenting(true);
    try {
      const { account } = walletFor(holderKey);
      const nonce = await publicClient.readContract({
        address: state.collection,
        abi: collectionAbi,
        functionName: "checkInNonce",
        args: [account.address],
      });
      // The typed venue code is bound into the digest the holder signs.
      const digest = checkInDigest(state.collection, seat.tokenId, nonce, code.trim());
      const sig = await account.signMessage({ message: { raw: digest } });
      presentToGate({
        tokenId: seat.tokenId.toString(),
        code: code.trim(),
        sig,
        holder: account.address,
        seat: seat.label,
      });
      onInfo(`Pass for ${seat.label} presented to the gate — waiting for scan…`);
    } finally {
      setPresenting(false);
    }
  }

  return (
    <div className="tickpass">
      <div className="sub">{state.name}</div>
      <div className="seatbig">Seat {seat.label}</div>
      <div className="sub">
        Tier {seat.tier} · face {formatEther(seat.price)} MON · token #{seat.tokenId.toString()}
      </div>
      <div className="qrish" title="Simulated QR — presented to the gate scanner" />
      <p className="sub">At the venue: type the code on the screens, then present.</p>
      <div className="formrow">
        <input
          value={code}
          placeholder="Venue code (e.g. MOSH-7421)"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <button className="primary" onClick={checkIn} disabled={presenting || code.length < 4}>
          {presenting ? "Signing…" : "Sign & present to gate (free — gate pays gas)"}
        </button>
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
    const logs = await publicClient.getLogs({
      address: state.stub,
      event: stubAbi[2],
      args: { to: address },
      fromBlock: 0n,
    });
    return logs.map((l) => ({
      stubId: l.args.stubId!,
      ticketId: l.args.ticketId!,
    }));
  }, 3000);

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

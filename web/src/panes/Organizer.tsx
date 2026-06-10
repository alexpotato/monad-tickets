import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { collectionAbi, walletFor, PERSONAS, type EventState } from "../lib/chain";

export function Organizer({ state }: { state: EventState }) {
  const [row, setRow] = useState("F");
  const [count, setCount] = useState(6);
  const [tier, setTier] = useState(1);
  const [price, setPrice] = useState("0.03");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const sold = state.seats.filter((s) => s.tokenId !== 0n);
  const checkedIn = sold.filter((s) => s.used);
  const revenue = sold.reduce((acc, s) => acc + s.price, 0n);

  async function listRow() {
    setBusy(true);
    setMsg(null);
    try {
      const labels = Array.from({ length: count }, (_, i) => `${row}-${i + 1}`);
      const { client } = walletFor(PERSONAS.organizer.key);
      await client.writeContract({
        address: state.collection,
        abi: collectionAbi,
        functionName: "listSeats",
        args: [labels, tier, parseEther(price)],
      });
      setMsg({ kind: "ok", text: `Listed ${count} seats in row ${row} at ${price} MON` });
    } catch (e) {
      setMsg({ kind: "err", text: shortError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="card">
        <h2>{state.name}</h2>
        <p className="sub">
          Starts {new Date(Number(state.eventStartTime) * 1000).toLocaleString()} · resale cap{" "}
          {formatEther(state.resaleCap)} MON · every sale &amp; resale settles on-chain
        </p>
        <div className="statrow">
          <div className="stat"><div className="v">{state.seats.length}</div><div className="l">Seats listed</div></div>
          <div className="stat"><div className="v">{sold.length}</div><div className="l">Sold</div></div>
          <div className="stat"><div className="v">{checkedIn.length}</div><div className="l">Checked in</div></div>
          <div className="stat"><div className="v">{formatEther(revenue)}</div><div className="l">MON revenue</div></div>
        </div>
      </div>

      <div className="card">
        <h4>Seat map (live from chain)</h4>
        <div className="seatgrid">
          {state.seats.map((s) => (
            <button
              key={s.label}
              className={`seat ${s.used ? "used" : s.tokenId !== 0n ? "sold" : ""}`}
              disabled
              title={
                s.tokenId === 0n
                  ? `${s.label} — available, ${formatEther(s.price)} MON`
                  : s.used
                    ? `${s.label} — checked in (ticket returned to event wallet)`
                    : `${s.label} — sold to ${s.owner?.slice(0, 8)}…`
              }
            >
              {s.label}
              <span className="price">
                {s.tokenId === 0n ? `${formatEther(s.price)}` : s.used ? "✓ in" : "sold"}
              </span>
            </button>
          ))}
        </div>
        <div className="legend">
          <span><i style={{ background: "var(--panel2)" }} />available</span>
          <span><i style={{ background: "#2a2333" }} />sold</span>
          <span><i style={{ background: "#15291f" }} />checked in</span>
        </div>
      </div>

      <div className="card">
        <h4>List more seats</h4>
        <div className="formrow">
          <input value={row} onChange={(e) => setRow(e.target.value.toUpperCase())} placeholder="Row (e.g. F)" />
          <input
            type="number"
            value={count}
            min={1}
            max={12}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </div>
        <div className="formrow">
          <select value={tier} onChange={(e) => setTier(Number(e.target.value))}>
            <option value={0}>Tier 0 — Floor</option>
            <option value={1}>Tier 1 — Balcony</option>
          </select>
          <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (MON)" />
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="primary" onClick={listRow} disabled={busy}>
            {busy ? "Listing…" : `List ${count} seats on-chain`}
          </button>
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      </div>
    </div>
  );
}

export function shortError(e: unknown): string {
  const s = String((e as Error)?.message ?? e);
  const m = s.match(/reverted with the following reason:\s*\n?(.*?)(\n|$)/) ?? s.match(/Error: (\w+\(\))/);
  return m ? m[1] : s.slice(0, 140);
}

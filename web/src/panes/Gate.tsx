import { useEffect, useRef, useState } from "react";
import { keccak256, toBytes } from "viem";
import { PERSONAS, collectionAbi, publicClient, walletFor, type EventState } from "../lib/chain";
import { onScan, announceResult, type ScanPayload } from "../lib/bus";
import { usePoll } from "../lib/hooks";
import { shortError } from "./Organizer";

const WORDS = ["MOSH", "ENCORE", "STAGE", "RIFF", "DRUM", "AMP", "VERSE", "CHORD"];

function randomCode() {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];
  const num = Math.floor(1000 + Math.random() * 9000);
  return `${word}-${num}`;
}

type LogEntry = { ok: boolean; text: string; at: string };

/// Elect exactly one tab as the active gate device. The gate pane can be
/// mounted in several tabs (the side-by-side demo view AND #/gate); without
/// election they would all submit check-ins from the same account and race
/// nonces. The Web Lock is held until the tab closes; the next tab takes over.
function useGateLeader(): boolean {
  const [leader, setLeader] = useState(false);
  useEffect(() => {
    // Web Locks needs a secure context; localhost qualifies. Over plain LAN
    // IP it's absent — assume single-gate usage there.
    if (!("locks" in navigator)) {
      setLeader(true);
      return;
    }
    let release: (() => void) | undefined;
    let cancelled = false;
    navigator.locks.request("tickets-gate-device", () => {
      if (cancelled) return;
      setLeader(true);
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    return () => {
      cancelled = true;
      setLeader(false);
      release?.();
    };
  }, []);
  return leader;
}

export function Gate({ state }: { state: EventState }) {
  const [code, setCode] = useState<string | null>(() => localStorage.getItem("gate-code"));
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const isLeader = useGateLeader();

  // Keep display-only tabs showing the code the leader most recently set.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "gate-code") setCode(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const { client: gateClient } = walletFor(PERSONAS.gate.key);

  // Serialize all gate transactions (rotations + check-ins) so rapid scans
  // can't fetch the same pending nonce concurrently.
  const txQueue = useRef<Promise<unknown>>(Promise.resolve());
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = txQueue.current.then(fn, fn);
    txQueue.current = run.catch(() => {});
    return run;
  }

  const [codeInfo] = usePoll(async () => {
    const [setAt, validity, onChainHash] = await Promise.all([
      publicClient.readContract({
        address: state.collection, abi: collectionAbi, functionName: "codeSetAt",
      }),
      publicClient.readContract({
        address: state.collection, abi: collectionAbi, functionName: "codeValidity",
      }),
      publicClient.readContract({
        address: state.collection, abi: collectionAbi, functionName: "currentCodeHash",
      }),
    ]);
    return { setAt, validity, onChainHash };
  });

  // The displayed plaintext is only trustworthy if its hash matches the chain
  // (a reset/reseed leaves a stale code in localStorage — show "rotate" then).
  const codeLive =
    code !== null &&
    codeInfo !== undefined &&
    keccak256(toBytes(code)) === codeInfo.onChainHash;

  function addLog(ok: boolean, text: string) {
    setLog((l) => [{ ok, text, at: new Date().toLocaleTimeString() }, ...l].slice(0, 30));
  }

  async function rotate() {
    setBusy(true);
    try {
      const next = randomCode();
      // Only the hash goes on-chain; the plaintext lives on the venue screens.
      await enqueue(() =>
        gateClient.writeContract({
          address: state.collection,
          abi: collectionAbi,
          functionName: "setGateCode",
          args: [keccak256(toBytes(next))],
        }),
      );
      setCode(next);
      localStorage.setItem("gate-code", next);
      addLog(true, `Code rotated → ${next}`);
    } catch (e) {
      addLog(false, `Rotate failed: ${shortError(e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Receive "QR scans" from the attendee phone and submit check-in on-chain.
  // The gate pays the gas — check-in is free for the attendee. Only the
  // leader tab processes scans; other tabs are display-only.
  useEffect(() => {
    if (!isLeader) return;
    return onScan(async (p: ScanPayload) => {
      const n = p.tokenIds.length;
      addLog(true, `Scanned pass: ${n} ticket${n > 1 ? "s" : ""} (${p.seats}) from ${p.holder.slice(0, 8)}…`);
      try {
        await enqueue(async () => {
          const hash = await gateClient.writeContract({
            address: state.collection,
            abi: collectionAbi,
            functionName: "checkInBatch",
            args: [p.tokenIds.map(BigInt), p.code, p.sig as `0x${string}`],
          });
          await publicClient.waitForTransactionReceipt({ hash });
        });
        addLog(true, `✓ Welcome! ${p.seats} checked in — tickets returned to event wallet, stubs minted.`);
        announceResult({
          tokenIds: p.tokenIds,
          ok: true,
          message: `✓ Checked in! ${p.seats} swapped for souvenir stub${n > 1 ? "s" : ""}. Enjoy the show.`,
        });
      } catch (e) {
        const reason = shortError(e);
        addLog(false, `✗ Rejected ${p.seats}: ${reason}`);
        announceResult({
          tokenIds: p.tokenIds,
          ok: false,
          message: `✗ Gate rejected your pass: ${reason}`,
        });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLeader, state.collection]);

  const remaining = codeInfo
    ? Math.max(0, Number(codeInfo.setAt) + Number(codeInfo.validity) - Math.floor(Date.now() / 1000))
    : null;

  return (
    <div>
      {!isLeader && (
        <div className="msg info">
          Another tab is the active gate scanner — this screen is display-only.
        </div>
      )}
      <div className="card gatecode">
        <p className="sub">VENUE SCREENS — TYPE THIS CODE IN YOUR APP</p>
        <div className="code">{codeLive ? code : "— — — —"}</div>
        <div className="ttl">
          {!codeLive
            ? "No active code on-chain — rotate to start admitting"
            : remaining !== null
              ? remaining > 0
                ? `expires in ${Math.floor(remaining / 60)}m ${remaining % 60}s`
                : "EXPIRED — rotate"
              : ""}
        </div>
        <div style={{ marginTop: 14 }}>
          <button className="primary" onClick={rotate} disabled={busy || !isLeader}>
            {busy ? "Committing hash on-chain…" : "Rotate venue code"}
          </button>
        </div>
      </div>

      <div className="card">
        <h4>Scanner feed</h4>
        <p className="sub">
          Waiting for passes… (attendee signs on their phone; this device submits and pays gas)
        </p>
        <div className="scanlog">
          {log.map((e, i) => (
            <div key={i} className={`scanentry ${e.ok ? "ok" : "err"}`}>
              <span className="mono">{e.at}</span> {e.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

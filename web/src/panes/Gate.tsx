import { useEffect, useRef, useState } from "react";
import { keccak256, toBytes } from "viem";
import { PERSONAS, POLL_MS, GAS, collectionAbi, publicClient, walletFor, type EventState } from "../lib/chain";
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
/// nonces. The Web Lock is held until the tab closes (or another tab steals
/// it via takeover); returns [isLeader, takeover].
function useGateLeader(): [boolean, () => void] {
  const [leader, setLeader] = useState(false);
  const stateRef = useRef<{ cancelled: boolean; release?: () => void }>({ cancelled: false });

  function acquire(steal: boolean) {
    const s = stateRef.current;
    navigator.locks
      .request("tickets-gate-device", steal ? { steal: true } : {}, () => {
        if (s.cancelled) return;
        setLeader(true);
        return new Promise<void>((resolve) => {
          s.release = resolve;
        });
      })
      // Resolves on voluntary release; rejects when another tab steals the
      // lock — either way this tab is no longer the scanner.
      .then(
        () => !s.cancelled && setLeader(false),
        () => !s.cancelled && setLeader(false),
      );
  }

  useEffect(() => {
    // Web Locks needs a secure context; localhost qualifies. Over plain LAN
    // IP it's absent — assume single-gate usage there.
    if (!("locks" in navigator)) {
      setLeader(true);
      return;
    }
    const s = stateRef.current;
    s.cancelled = false;
    acquire(false);
    return () => {
      s.cancelled = true;
      setLeader(false);
      s.release?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const takeover = () => {
    if (!("locks" in navigator)) return;
    acquire(true);
  };
  return [leader, takeover];
}

export function Gate({ state, refresh }: { state: EventState; refresh: () => void }) {
  const [code, setCode] = useState<string | null>(() => localStorage.getItem("gate-code"));
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [isLeader, takeover] = useGateLeader();

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

  const [codeInfo, refreshCodeInfo] = usePoll(async () => {
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
  }, POLL_MS);

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
      // Wait for the receipt, then re-read the on-chain hash immediately —
      // otherwise the display sits on "— — — —" until the next slow poll.
      await enqueue(async () => {
        const hash = await gateClient.writeContract({
          address: state.collection,
          abi: collectionAbi,
          functionName: "setGateCode",
          args: [keccak256(toBytes(next))],
          gas: GAS.setGateCode,
        });
        await publicClient.waitForTransactionReceipt({ hash });
      });
      setCode(next);
      localStorage.setItem("gate-code", next);
      refreshCodeInfo();
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
            gas: GAS.checkInBatch,
          });
          await publicClient.waitForTransactionReceipt({ hash });
        });
        refresh(); // flip the seats to checked-in on every pane immediately
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
        <div className="msg info" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1 }}>
            Another tab is the active gate scanner — this screen is display-only.
          </span>
          <button className="ghost" onClick={takeover}>
            Scan here instead
          </button>
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

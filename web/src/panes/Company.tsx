import { formatEther, type Address } from "viem";
import {
  PROFILE,
  POLL_MS,
  loyaltyAbi,
  stubAbi,
  publicClient,
  type EventState,
} from "../lib/chain";
import { deviceWalletAddress } from "../lib/profiles";
import { usePoll } from "../lib/hooks";

type Row = {
  wallet: Address;
  stubs: number;
  score: bigint;
  holding: number; // unchecked tickets currently held
};

/// Company view: every wallet that has touched the event, with attendance
/// (stubs), loyalty score, and current holdings. This is the core
/// anti-scalping signal made visible — wallets that buy and attend versus
/// wallets that hold and flip — all derived from public chain data.
export function Company({ state }: { state: EventState }) {
  const me = deviceWalletAddress().toLowerCase();

  const [rows] = usePoll(async () => {
    // Attendance: every StubMinted since the factory deploy.
    const logs = await publicClient.getLogs({
      address: state.stub,
      event: stubAbi[2],
      fromBlock: PROFILE.fromBlock,
    });
    const stubsBy = new Map<string, number>();
    for (const l of logs) {
      const to = (l.args.to as Address).toLowerCase();
      stubsBy.set(to, (stubsBy.get(to) ?? 0) + 1);
    }

    // Current holders from the live seat map.
    const holdingBy = new Map<string, number>();
    for (const s of state.seats) {
      if (s.tokenId !== 0n && !s.used && s.owner) {
        const o = s.owner.toLowerCase();
        holdingBy.set(o, (holdingBy.get(o) ?? 0) + 1);
      }
    }

    const wallets = [...new Set([...stubsBy.keys(), ...holdingBy.keys()])] as Address[];

    // Loyalty scores in one round (Multicall3 on testnet, batch on anvil).
    const scoreCalls = wallets.map((w) => ({
      address: state.loyalty,
      abi: loyaltyAbi,
      functionName: "scoreOf",
      args: [w],
    }));
    const scores: bigint[] =
      wallets.length === 0
        ? []
        : PROFILE.chain.contracts?.multicall3
          ? ((await publicClient.multicall({
              contracts: scoreCalls as never,
              allowFailure: false,
            })) as bigint[])
          : await Promise.all(
              scoreCalls.map((c) => publicClient.readContract(c as never) as Promise<bigint>),
            );

    const out: Row[] = wallets.map((wallet, i) => ({
      wallet,
      stubs: stubsBy.get(wallet.toLowerCase()) ?? 0,
      score: scores[i],
      holding: holdingBy.get(wallet.toLowerCase()) ?? 0,
    }));
    out.sort((a, b) => b.stubs - a.stubs || Number(b.score - a.score));
    return out;
  }, POLL_MS);

  const totalStubs = (rows ?? []).reduce((n, r) => n + r.stubs, 0);
  const attendees = (rows ?? []).filter((r) => r.stubs > 0).length;
  const sold = state.seats.filter((s) => s.tokenId !== 0n);
  const revenue = sold.reduce((acc, s) => acc + s.price, 0n);

  return (
    <div>
      <div className="card">
        <h2>{state.name} — audience</h2>
        <p className="sub">
          Every wallet, straight from chain data: stubs prove attendance, holdings show open
          tickets, loyalty separates fans from flippers.
        </p>
        <div className="statrow">
          <div className="stat"><div className="v">{rows?.length ?? "…"}</div><div className="l">Wallets</div></div>
          <div className="stat"><div className="v">{attendees}</div><div className="l">Attended</div></div>
          <div className="stat"><div className="v">{totalStubs}</div><div className="l">Stubs minted</div></div>
          <div className="stat"><div className="v">{formatEther(revenue)}</div><div className="l">MON revenue</div></div>
        </div>
      </div>

      <div className="card">
        <h4>Wallets by attendance</h4>
        {rows === undefined && <p className="sub">Reading chain history…</p>}
        {rows !== undefined && rows.length === 0 && (
          <p className="sub">No buyers or attendees yet.</p>
        )}
        {rows !== undefined && rows.length > 0 && (
          <table className="rostr">
            <thead>
              <tr><th>Wallet</th><th>Holding</th><th>Stubs</th><th>Loyalty</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.wallet}>
                  <td className="mono">
                    {r.wallet.slice(0, 10)}…{r.wallet.slice(-6)}
                    {r.wallet.toLowerCase() === me && <span className="youtag"> you</span>}
                  </td>
                  <td>{r.holding || "—"}</td>
                  <td>{r.stubs ? `🎟 ${r.stubs}` : "—"}</td>
                  <td className={r.score < 0n ? "neg" : ""}>{r.score.toString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

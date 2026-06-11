import { useEffect, useState } from "react";
import { Organizer } from "./panes/Organizer";
import { Attendee } from "./panes/Attendee";
import { Gate } from "./panes/Gate";
import { Company } from "./panes/Company";
import { Presentation } from "./panes/Presentation";
import { loadEventState, PROFILE, POLL_MS } from "./lib/chain";
import { PROFILES, switchProfile } from "./lib/profiles";
import { usePoll } from "./lib/hooks";

type Route = "demo" | "organizer" | "attendee" | "gate" | "company" | "presentation";

// The default URL IS the wallet app. Operator surfaces live at their own
// URLs: #/admin (organizer dashboard), #/gate (venue gate), #/demo (the
// three-pane control room).
function routeFromHash(): Route {
  const h = window.location.hash.replace("#/", "");
  if (h === "admin" || h === "organizer") return "organizer";
  if (h === "gate") return "gate";
  if (h === "demo") return "demo";
  if (h === "company") return "company";
  if (h === "presentation") return "presentation";
  return "attendee";
}

function ProfileSwitch() {
  return (
    <select
      value={PROFILE.id}
      onChange={(e) => switchProfile(e.target.value as "local" | "testnet")}
      style={{ width: "auto", padding: "6px 10px", fontSize: 13 }}
      title="Which chain this app talks to"
    >
      {Object.values(PROFILES).map((p) => (
        <option key={p.id} value={p.id}>{p.label}</option>
      ))}
    </select>
  );
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [result, refresh] = usePoll(loadEventState, POLL_MS);
  // Hold the last good state so a transient RPC failure (public testnet rate
  // limiting) doesn't dump a working session back to the boot screen.
  const [last, setLast] = useState<Extract<typeof result, object>>();
  useEffect(() => {
    if (typeof result === "object") setLast(result);
  }, [result]);
  const state = typeof result === "object" ? result : last;

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route === "presentation") {
    return <Presentation state={state} />;
  }

  if (result === undefined) {
    return <div className="boot">Connecting to {PROFILE.label}…</div>;
  }
  if (state === undefined) {
    return (
      <div className="boot">
        <h2>
          {PROFILE.label}: {result === "no-factory" ? "not deployed" : "chain unreachable"}
        </h2>
        {result === "no-factory" ? (
          <p>
            The contracts aren't deployed on this chain yet — see TESTNET.md in the repo for
            the deploy runbook.
          </p>
        ) : PROFILE.id === "local" ? (
          <>
            <p>Start the local chain and seed the demo:</p>
            <pre>
              anvil{"\n"}cd contracts{"\n"}forge script script/Demo.s.sol --rpc-url
              http://127.0.0.1:8545 --broadcast
            </pre>
          </>
        ) : (
          <p>
            Couldn't reach the {PROFILE.label} RPC (down or rate-limited). Retrying
            automatically…
          </p>
        )}
        <p style={{ marginTop: 16 }}>
          <ProfileSwitch />
        </p>
      </div>
    );
  }

  // The wallet app keeps a minimal header; operator pages get the full nav.
  const isOperator = route !== "attendee";

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">⛓ Monad Tickets</span>
        {isOperator && (
          <>
            <nav>
              <a href="#/demo" className={route === "demo" ? "active" : ""}>Demo</a>
              <a href="#/admin" className={route === "organizer" ? "active" : ""}>Admin</a>
              <a href="#/company" className={route === "company" ? "active" : ""}>Company</a>
            <a href="#/presentation">Slides</a>
              <a href="#/gate" className={route === "gate" ? "active" : ""}>Gate</a>
            </nav>
            <ProfileSwitch />
          </>
        )}
      </header>
      {route === "demo" && (
        <div className="threepane">
          <section><h3 className="panetitle">Organizer dashboard</h3><Organizer state={state} refresh={refresh} /></section>
          <section><h3 className="panetitle">Attendee phone</h3><Attendee state={state} refresh={refresh} /></section>
          <section><h3 className="panetitle">Venue gate</h3><Gate state={state} refresh={refresh} /></section>
        </div>
      )}
      {route === "organizer" && <div className="single"><Organizer state={state} refresh={refresh} /></div>}
      {route === "company" && <div className="single"><Company state={state} /></div>}
      {route === "attendee" && <div className="single"><Attendee state={state} refresh={refresh} /></div>}
      {route === "gate" && <div className="single"><Gate state={state} refresh={refresh} /></div>}
    </div>
  );
}

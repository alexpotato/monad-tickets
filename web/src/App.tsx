import { useEffect, useState } from "react";
import { Organizer } from "./panes/Organizer";
import { Attendee } from "./panes/Attendee";
import { Gate } from "./panes/Gate";
import { loadEventState, PROFILE, POLL_MS } from "./lib/chain";
import { PROFILES, switchProfile } from "./lib/profiles";
import { usePoll } from "./lib/hooks";

type Route = "all" | "organizer" | "attendee" | "gate";

function routeFromHash(): Route {
  const h = window.location.hash.replace("#/", "");
  if (h === "organizer" || h === "attendee" || h === "gate") return h;
  // On a phone (or installed PWA) the attendee experience IS the app;
  // the side-by-side control room only makes sense on a big screen.
  return window.matchMedia("(max-width: 800px)").matches ? "attendee" : "all";
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
  const [result] = usePoll(loadEventState, POLL_MS);
  const state = typeof result === "object" ? result : undefined;

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

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

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">⛓ Monad Tickets</span>
        <nav>
          <a href="#/" className={route === "all" ? "active" : ""}>Demo</a>
          <a href="#/organizer" className={route === "organizer" ? "active" : ""}>Organizer</a>
          <a href="#/attendee" className={route === "attendee" ? "active" : ""}>Attendee</a>
          <a href="#/gate" className={route === "gate" ? "active" : ""}>Gate</a>
        </nav>
        <ProfileSwitch />
      </header>
      {route === "all" && (
        <div className="threepane">
          <section><h3 className="panetitle">Organizer dashboard</h3><Organizer state={state} /></section>
          <section><h3 className="panetitle">Attendee phone</h3><Attendee state={state} /></section>
          <section><h3 className="panetitle">Venue gate</h3><Gate state={state} /></section>
        </div>
      )}
      {route === "organizer" && <div className="single"><Organizer state={state} /></div>}
      {route === "attendee" && <div className="single"><Attendee state={state} /></div>}
      {route === "gate" && <div className="single"><Gate state={state} /></div>}
    </div>
  );
}

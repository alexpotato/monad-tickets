import { useEffect, useState } from "react";
import { Organizer } from "./panes/Organizer";
import { Attendee } from "./panes/Attendee";
import { Gate } from "./panes/Gate";
import { loadEventState } from "./lib/chain";
import { usePoll } from "./lib/hooks";

type Route = "all" | "organizer" | "attendee" | "gate";

function routeFromHash(): Route {
  const h = window.location.hash.replace("#/", "");
  if (h === "organizer" || h === "attendee" || h === "gate") return h;
  return "all";
}

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash());
  const [state] = usePoll(loadEventState);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (state === undefined) return <div className="boot">Connecting to anvil…</div>;
  if (state === null) {
    return (
      <div className="boot">
        <h2>Chain not ready</h2>
        <p>Start the local chain and seed the demo:</p>
        <pre>
          anvil{"\n"}cd contracts{"\n"}forge script script/Demo.s.sol --rpc-url
          http://127.0.0.1:8545 --broadcast
        </pre>
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

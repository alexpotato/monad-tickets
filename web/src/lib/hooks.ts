import { useEffect, useState } from "react";

/// Poll an async loader on an interval; returns latest value + manual refresh.
export function usePoll<T>(load: () => Promise<T>, intervalMs = 2000): [T | undefined, () => void] {
  const [value, setValue] = useState<T>();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const run = () => load().then((v) => alive && setValue(v));
    run();
    const id = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, intervalMs]);

  return [value, () => setTick((t) => t + 1)];
}

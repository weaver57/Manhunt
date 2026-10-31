import { useEffect, useState } from 'react';

/**
 * A once-per-second clock tick drives the HUD countdown. The value is the
 * raw `Date.now()` at each render so downstream maths stays drift-free.
 */
export function useGameClock(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [enabled]);
  return now;
}

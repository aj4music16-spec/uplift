import { useCallback, useRef, useState } from 'react';

/**
 * Runs one auth request at a time and keeps its failure for inline display.
 * Auth requests are never retried automatically.
 */
export function useAuthTask() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const busy = useRef(false);
  const run = useCallback(async <T,>(task: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> => {
    if (busy.current) return { ok: false, error: new Error('busy') };
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const value = await task();
      return { ok: true, value };
    } catch (caught) {
      setError(caught);
      return { ok: false, error: caught };
    } finally {
      busy.current = false;
      setPending(false);
    }
  }, []);
  return { pending, error, setError, run };
}

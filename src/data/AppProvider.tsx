import { QueryCache, QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import * as Localization from 'expo-localization';
import type { ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { AppError, toAppError } from '@/domain/errors';
import { isValidTimeZone } from '@/domain/time';
import { config } from '@/lib/config';
import { readEvidenceBytes } from '@/lib/evidence';
import { kv } from '@/lib/storage';
import { getSupabase } from '@/lib/supabase';

import { createDemo, type Demo } from './demo/createDemo';
import { DemoRepository } from './demo/DemoRepository';
import type { AuthService, AuthSession, Repository } from './repository';
import { PEOPLE, type PersonKey } from './scenario/innerCircle';
import { SupabaseAuthService } from './supabase/SupabaseAuthService';
import { SupabaseRepository } from './supabase/SupabaseRepository';

export type Phase = 'loading' | 'signed_out' | 'signed_in';

export interface DemoControls {
  persona: PersonKey;
  personas: { key: PersonKey; name: string; avatar: (typeof PEOPLE)[PersonKey]['avatar'] }[];
  /** See the app as another sample person (for example the admin, then a player). */
  switchPersona: (key: PersonKey) => void;
  /** Moves the demo clock forward so deadlines and results can be explored. */
  advanceClock: (hours: number) => void;
  /** Rebuilds the sample data from scratch. */
  reset: () => Promise<void>;
  enter: (key?: PersonKey) => void;
  leave: () => void;
}

interface AppContextValue {
  mode: 'live' | 'demo';
  phase: Phase;
  session: AuthSession | null;
  repository: Repository;
  /** Null in Demo Mode: there are no accounts to sign in to. */
  auth: AuthService | null;
  demo: DemoControls | null;
  /** Why the last session ended, so the welcome screen can explain it. */
  notice: 'expired' | null;
  clearNotice: () => void;
  /** An invitation opened before signing in, kept until it can be accepted. */
  pendingInvite: string | null;
  setPendingInvite: (code: string | null) => void;
  deviceTimeZone: string;
  signOut: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);
const INVITE_KEY = 'uplift.pending-invite';

export function deviceTimeZone(): string {
  const fromCalendar = Localization.getCalendars()[0]?.timeZone;
  if (fromCalendar && isValidTimeZone(fromCalendar)) return fromCalendar;
  try {
    const fromIntl = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (isValidTimeZone(fromIntl)) return fromIntl;
  } catch {
    // fall through
  }
  return 'UTC';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const mode: 'live' | 'demo' = config.demoMode ? 'demo' : 'live';
  const timeZone = useMemo(deviceTimeZone, []);
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [notice, setNotice] = useState<'expired' | null>(null);
  const [pendingInvite, setPendingInviteState] = useState<string | null>(null);
  const [demo, setDemo] = useState<Demo | null>(null);
  const [persona, setPersona] = useState<PersonKey>('aj');
  const expiredRef = useRef<() => void>(() => undefined);

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            // Reads may retry on a flaky connection. Nothing else does.
            retry: (count, error) => toAppError(error).code === 'NETWORK' && count < 2,
            refetchOnWindowFocus: false,
          },
          // Non-idempotent operations are never retried silently.
          mutations: { retry: false },
        },
        queryCache: new QueryCache({
          onError: (error) => {
            if (toAppError(error).code === 'SESSION_EXPIRED') expiredRef.current();
          },
        }),
        mutationCache: new MutationCache({
          onError: (error) => {
            if (toAppError(error).code === 'SESSION_EXPIRED') expiredRef.current();
          },
        }),
      }),
    [],
  );

  const live = useMemo(() => {
    if (mode !== 'live') return null;
    const client = getSupabase();
    return { auth: new SupabaseAuthService(client), repository: new SupabaseRepository(client, readEvidenceBytes) };
  }, [mode]);

  /* Pending invitation survives sign-up, email verification and profile setup. */
  useEffect(() => {
    void kv.get(INVITE_KEY).then((code) => {
      if (code) setPendingInviteState(code);
    });
  }, []);
  const setPendingInvite = useCallback((code: string | null) => {
    setPendingInviteState(code);
    if (code) void kv.set(INVITE_KEY, code);
    else void kv.remove(INVITE_KEY);
  }, []);

  const clearUserState = useCallback(() => {
    // Nothing user-scoped outlives the session.
    queryClient.clear();
    void kv.clearUserScoped();
  }, [queryClient]);

  /* Live session */
  useEffect(() => {
    if (!live) return undefined;
    let alive = true;
    live.auth
      .getSession()
      .then((current) => {
        if (!alive) return;
        setSession(current);
        setPhase(current ? 'signed_in' : 'signed_out');
      })
      .catch(() => {
        if (alive) setPhase('signed_out');
      });
    const unsubscribe = live.auth.onChange((next, event) => {
      if (!alive) return;
      setSession((previous) => {
        if (previous?.userId !== next?.userId) clearUserState();
        return next;
      });
      setPhase(next ? 'signed_in' : 'signed_out');
      if (event === 'signed_in') setNotice(null);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [live, clearUserState]);

  expiredRef.current = () => {
    if (!live || phase !== 'signed_in') return;
    setNotice('expired');
    void live.auth.signOut();
  };

  /* Demo */
  const buildDemo = useCallback(async () => {
    const built = await createDemo({ timeZone });
    setDemo(built);
    return built;
  }, [timeZone]);

  useEffect(() => {
    if (mode !== 'demo') return;
    let alive = true;
    void buildDemo().then(() => {
      if (alive) setPhase('signed_out');
    });
    return () => {
      alive = false;
    };
  }, [mode, buildDemo]);

  const demoControls = useMemo<DemoControls | null>(() => {
    if (mode !== 'demo' || !demo) return null;
    return {
      persona,
      personas: (Object.keys(PEOPLE) as PersonKey[]).map((key) => ({ key, name: PEOPLE[key].name, avatar: PEOPLE[key].avatar })),
      switchPersona: (key) => {
        clearUserState();
        setPersona(key);
        setSession({ userId: demo.scenario.people[key].id, email: null });
      },
      advanceClock: (hours) => {
        demo.backend.clock.advance(hours * 3_600_000);
        void queryClient.invalidateQueries();
      },
      reset: async () => {
        clearUserState();
        const rebuilt = await buildDemo();
        setSession((current) => (current ? { userId: rebuilt.scenario.people[persona].id, email: null } : null));
      },
      enter: (key = 'aj') => {
        clearUserState();
        setPersona(key);
        setSession({ userId: demo.scenario.people[key].id, email: null });
        setPhase('signed_in');
      },
      leave: () => {
        clearUserState();
        setSession(null);
        setPhase('signed_out');
      },
    };
  }, [mode, demo, persona, clearUserState, queryClient, buildDemo]);

  const repository = useMemo<Repository>(() => {
    if (live) return live.repository;
    if (demo) return new DemoRepository(demo.backend, session?.userId ?? null, 140);
    // Before the demo has been built: every call fails as "not signed in".
    return new Proxy({} as Repository, {
      get: (_target, property) => {
        if (property === 'mode') return 'demo';
        if (property === 'now') return () => new Date();
        if (property === 'subscribeToCircle') return () => () => undefined;
        return () => Promise.reject(new AppError('AUTH_REQUIRED'));
      },
    });
  }, [live, demo, session?.userId]);

  const signOut = useCallback(async () => {
    if (live) await live.auth.signOut();
    else demoControls?.leave();
    clearUserState();
  }, [live, demoControls, clearUserState]);

  const value = useMemo<AppContextValue>(
    () => ({
      mode,
      phase,
      session,
      repository,
      auth: live?.auth ?? null,
      demo: demoControls,
      notice,
      clearNotice: () => setNotice(null),
      pendingInvite,
      setPendingInvite,
      deviceTimeZone: timeZone,
      signOut,
    }),
    [mode, phase, session, repository, live, demoControls, notice, pendingInvite, setPendingInvite, timeZone, signOut],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppContext.Provider value={value}>{children}</AppContext.Provider>
    </QueryClientProvider>
  );
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

export function useRepository(): Repository {
  return useApp().repository;
}

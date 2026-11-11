import { z } from 'zod';

/**
 * Validated public configuration. Only EXPO_PUBLIC_* values exist here because
 * anything in the app bundle is public. A service-role / secret key must never
 * be configured for the app; if one is detected the app refuses to start.
 */
const Env = z.object({
  appEnv: z.enum(['development', 'preview', 'production']).catch('development'),
  demoFlag: z.string().optional(),
  supabaseUrl: z.string().optional(),
  supabaseKey: z.string().optional(),
});

function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  const parts = key.split('.');
  if (parts.length !== 3 || !parts[1]) return false;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(globalThis.atob(normalized)) as { role?: string };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function load() {
  // Each variable is referenced statically so the bundler can inline it.
  const env = Env.parse({
    appEnv: process.env.EXPO_PUBLIC_APP_ENV,
    demoFlag: process.env.EXPO_PUBLIC_DEMO_MODE,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  const url = env.supabaseUrl?.trim() ?? '';
  const key = env.supabaseKey?.trim() ?? '';
  const configured = /^https?:\/\//.test(url) && !url.includes('YOUR-PROJECT-REF') && key.length > 20 && !key.includes('YOUR-PUBLISHABLE-KEY');
  if (configured && looksLikeSecretKey(key)) {
    throw new Error('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a service-role/secret key. Never ship that in the app. Use the publishable (anon) key.');
  }
  const demoRequested = env.demoFlag === 'true' || env.demoFlag === '1';
  return {
    appEnv: env.appEnv,
    /** Demo Mode never contacts a backend. It is on when asked for, or when no backend is configured. */
    demoMode: demoRequested || !configured,
    demoReason: demoRequested ? ('requested' as const) : !configured ? ('not-configured' as const) : null,
    supabaseUrl: configured ? url : null,
    supabaseKey: configured ? key : null,
  };
}

export const config = load();
export type AppConfig = typeof config;

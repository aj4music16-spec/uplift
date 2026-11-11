import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { config } from './config';
import { sessionStorage } from './storage';

let client: SupabaseClient | null = null;

/**
 * The app's single Supabase client, created lazily and only when a backend is
 * configured. Demo Mode never calls this, so it can never reach a real account.
 * It only ever holds the publishable key; authorization is enforced by RLS and
 * server functions.
 */
export function getSupabase(): SupabaseClient {
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error('Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or run in Demo Mode.');
  }
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        storage: sessionStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    if (Platform.OS !== 'web') {
      // Refresh tokens only while the app is in the foreground.
      AppState.addEventListener('change', (state) => {
        if (state === 'active') void client?.auth.startAutoRefresh();
        else void client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}

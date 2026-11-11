import type { Session, SupabaseClient } from '@supabase/supabase-js';

import type { AuthService, AuthSession } from '../repository';
import { mapAuthError } from './errors';

const toSession = (session: Session | null): AuthSession | null =>
  session?.user ? { userId: session.user.id, email: session.user.email ?? null } : null;

/**
 * Email + password accounts on Supabase Auth. Verification and password reset
 * use a 6-digit emailed code typed into the app, so no deep link is required.
 */
export class SupabaseAuthService implements AuthService {
  readonly mode = 'live' as const;

  constructor(private readonly client: SupabaseClient) {}

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw mapAuthError(error);
    return toSession(data.session);
  }

  onChange(listener: Parameters<AuthService['onChange']>[0]): () => void {
    let hadSession = false;
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      const next = toSession(session);
      if (event === 'PASSWORD_RECOVERY') listener(next, 'recovery');
      else if (event === 'TOKEN_REFRESHED') listener(next, 'refreshed');
      else if (event === 'SIGNED_OUT') listener(null, hadSession ? 'signed_out' : 'signed_out');
      else if (next) listener(next, 'signed_in');
      hadSession = !!next;
    });
    return () => data.subscription.unsubscribe();
  }

  async signUp(input: { email: string; password: string }): Promise<{ needsVerification: boolean }> {
    const { data, error } = await this.client.auth.signUp({ email: input.email.trim().toLowerCase(), password: input.password });
    if (error) throw mapAuthError(error);
    // With confirmations on there is no session until the emailed code is entered.
    return { needsVerification: !data.session };
  }

  async signIn(input: { email: string; password: string }): Promise<void> {
    const { error } = await this.client.auth.signInWithPassword({ email: input.email.trim().toLowerCase(), password: input.password });
    if (error) throw mapAuthError(error);
  }

  async resendVerification(email: string): Promise<void> {
    const { error } = await this.client.auth.resend({ type: 'signup', email: email.trim().toLowerCase() });
    if (error) throw mapAuthError(error);
  }

  async verifyCode(input: { email: string; code: string; purpose: 'signup' | 'recovery' }): Promise<void> {
    const { error } = await this.client.auth.verifyOtp({
      email: input.email.trim().toLowerCase(),
      token: input.code.trim(),
      type: input.purpose === 'signup' ? 'signup' : 'recovery',
    });
    if (error) throw mapAuthError(error);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const { error } = await this.client.auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (error) throw mapAuthError(error);
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.client.auth.updateUser({ password });
    if (error) throw mapAuthError(error);
  }

  async signOut(): Promise<void> {
    const { error } = await this.client.auth.signOut();
    // Signing out locally must always succeed, even offline or with a dead session.
    if (error) await this.client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }
}

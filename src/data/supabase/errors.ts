import { AppError, isErrorCode } from '@/domain/errors';

interface PostgrestLikeError {
  message?: string;
  details?: string | null;
  code?: string;
  status?: number;
  name?: string;
}

/**
 * Server functions raise an error code from src/domain/errors.ts as the
 * exception message (SQLSTATE P0001) and an optional human-readable detail.
 * Everything else is mapped conservatively; raw database messages are never
 * shown to people.
 */
export function mapBackendError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const e = (error ?? {}) as PostgrestLikeError;
  const message = typeof e.message === 'string' ? e.message : '';

  if (isErrorCode(message)) return new AppError(message, e.details && e.details.length > 0 ? e.details : undefined);
  if (/failed to fetch|network request failed|fetch failed|networkerror|load failed|aborted|timeout/i.test(message)) {
    return new AppError('NETWORK');
  }
  if (e.code === 'PGRST301' || e.code === 'PGRST303' || /jwt expired|invalid jwt|jwt.*invalid/i.test(message) || e.status === 401) {
    return new AppError('SESSION_EXPIRED');
  }
  // 42501 insufficient_privilege, and RLS violations on direct writes.
  if (e.code === '42501' || /row-level security|permission denied/i.test(message) || e.status === 403) {
    return new AppError('FORBIDDEN');
  }
  // Class 22 (data exception) and 23 (constraint violation): malformed or impossible input.
  if (typeof e.code === 'string' && /^(22|23)/.test(e.code)) return new AppError('VALIDATION');
  if (e.code === 'PGRST116' || e.status === 404 || /object not found|not found/i.test(message)) return new AppError('NOT_FOUND');
  if (e.status === 429 || /rate limit|too many requests/i.test(message)) return new AppError('RATE_LIMITED');
  return new AppError('UNKNOWN');
}

export function mapAuthError(error: unknown): AppError {
  const e = (error ?? {}) as PostgrestLikeError & { code?: string };
  const message = (typeof e.message === 'string' ? e.message : '').toLowerCase();
  const code = typeof e.code === 'string' ? e.code : '';
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) return new AppError('EMAIL_NOT_VERIFIED');
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return new AppError('INVALID_CREDENTIALS');
  if (code === 'user_already_exists' || code === 'email_exists' || message.includes('already registered')) return new AppError('EMAIL_IN_USE');
  if (code === 'weak_password' || message.includes('password should be')) return new AppError('WEAK_PASSWORD');
  if (code === 'otp_expired' || message.includes('token has expired') || message.includes('otp')) {
    return new AppError('VALIDATION', 'That code is wrong or has expired. Request a new one.');
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e.status === 429) return new AppError('RATE_LIMITED');
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || message.includes('refresh token')) return new AppError('SESSION_EXPIRED');
  if (/failed to fetch|network request failed|fetch failed/.test(message)) return new AppError('NETWORK');
  if (code === 'validation_failed' || message.includes('invalid format') || message.includes('unable to validate email')) {
    return new AppError('VALIDATION', 'Enter a valid email address.');
  }
  return new AppError('UNKNOWN');
}

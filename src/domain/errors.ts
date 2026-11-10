/**
 * Structured error codes shared by the server functions, both repositories and
 * the UI. Server functions raise the code as the exception message; the
 * repositories convert that into an AppError; screens show `describeError`.
 */
export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'RULES_CHANGED',
  'CHALLENGE_STARTED',
  'NOT_STARTED',
  'CHALLENGE_CLOSED',
  'DAY_NOT_STARTED',
  'DAY_NOT_FINISHED',
  'DEADLINE_PASSED',
  'EVIDENCE_REQUIRED',
  'UPLOAD_INCOMPLETE',
  'REVIEW_PENDING',
  'ALREADY_DECIDED',
  'REVISION_CONFLICT',
  'DISPUTE_OPEN',
  'DISPUTE_WINDOW_OPEN',
  'DISPUTE_WINDOW_CLOSED',
  'DEADLINE_NOT_REACHED',
  'PROPOSAL_PENDING',
  'LAST_ADMIN',
  'LAST_OWNER',
  'LIMIT_REACHED',
  'INVITE_INVALID',
  'INVITE_EXPIRED',
  'RATE_LIMITED',
  'LIVE_PAYMENTS_DISABLED',
  'EMAIL_NOT_VERIFIED',
  'INVALID_CREDENTIALS',
  'EMAIL_IN_USE',
  'WEAK_PASSWORD',
  'NETWORK',
  'UNEXPECTED_RESPONSE',
  'UNKNOWN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

export class AppError extends Error {
  readonly code: ErrorCode;
  /** Field-level problems for VALIDATION, or other safe context. Never secrets. */
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    if (isErrorCode(error.message)) return new AppError(error.message);
    if (/network request failed|failed to fetch|networkerror|load failed/i.test(error.message)) {
      return new AppError('NETWORK', error.message);
    }
    return new AppError('UNKNOWN', error.message);
  }
  return new AppError('UNKNOWN');
}

export interface ErrorCopy {
  title: string;
  message: string;
  /** Whether retrying the same request can succeed without changing anything. */
  retryable: boolean;
}

const COPY: Record<ErrorCode, ErrorCopy> = {
  AUTH_REQUIRED: { title: 'Sign in to continue', message: 'You need to be signed in to do that.', retryable: false },
  SESSION_EXPIRED: {
    title: 'You were signed out',
    message: 'Your session ended. Sign in again to pick up where you left off.',
    retryable: false,
  },
  FORBIDDEN: {
    title: 'You don’t have access',
    message: 'Your access to this may have changed. Go back and refresh to see what you can still open.',
    retryable: false,
  },
  NOT_FOUND: { title: 'Not found', message: 'This doesn’t exist anymore, or you can’t see it.', retryable: false },
  VALIDATION: { title: 'Check the details', message: 'Some of the details aren’t valid yet.', retryable: false },
  RULES_CHANGED: {
    title: 'The rules changed',
    message: 'The admin updated the rules while you were reading. Review the latest version before joining.',
    retryable: false,
  },
  CHALLENGE_STARTED: {
    title: 'Already started',
    message: 'This challenge has started, so it isn’t open to new players. Ask for a rematch next time.',
    retryable: false,
  },
  NOT_STARTED: { title: 'Not started yet', message: 'Check-ins open when the challenge starts.', retryable: false },
  CHALLENGE_CLOSED: {
    title: 'Challenge closed',
    message: 'This challenge is finished or canceled, so it can’t be changed.',
    retryable: false,
  },
  DAY_NOT_STARTED: { title: 'That day hasn’t started', message: 'You can only check in for today or a past day.', retryable: false },
  DAY_NOT_FINISHED: {
    title: 'The day isn’t over yet',
    message: 'A screenshot only proves a full day once that day has ended. Submit it tomorrow before noon.',
    retryable: false,
  },
  DEADLINE_PASSED: {
    title: 'Deadline passed',
    message: 'On-time check-ins closed at noon the next day. You can send a late submission for the admin to consider.',
    retryable: false,
  },
  EVIDENCE_REQUIRED: {
    title: 'Proof is required',
    message: 'This challenge needs a screenshot or photo with each check-in.',
    retryable: false,
  },
  UPLOAD_INCOMPLETE: {
    title: 'Upload didn’t finish',
    message: 'Your proof wasn’t uploaded, so nothing was submitted. Check your connection and try again.',
    retryable: true,
  },
  REVIEW_PENDING: {
    title: 'Waiting on review',
    message: 'There are submissions still waiting for an admin decision.',
    retryable: false,
  },
  ALREADY_DECIDED: {
    title: 'Already decided',
    message: 'This day has a final decision. If you disagree, open a dispute.',
    retryable: false,
  },
  REVISION_CONFLICT: {
    title: 'Someone changed this first',
    message: 'This was updated while you had it open. We’ve loaded the latest version — take another look.',
    retryable: false,
  },
  DISPUTE_OPEN: { title: 'Dispute in progress', message: 'An open dispute has to be resolved first.', retryable: false },
  DISPUTE_WINDOW_OPEN: {
    title: 'Dispute window still open',
    message: 'Players have 24 hours after a decision to dispute it. Results can be finalized after that.',
    retryable: false,
  },
  DISPUTE_WINDOW_CLOSED: {
    title: 'Dispute window closed',
    message: 'Disputes can be opened for 24 hours after a decision.',
    retryable: false,
  },
  DEADLINE_NOT_REACHED: {
    title: 'Too early to finalize',
    message: 'The last day’s check-ins are still open until noon.',
    retryable: false,
  },
  PROPOSAL_PENDING: {
    title: 'A rule change is already proposed',
    message: 'Wait for everyone to respond, or withdraw the current proposal first.',
    retryable: false,
  },
  LAST_ADMIN: {
    title: 'Someone has to be admin',
    message: 'Every challenge needs at least one admin. Appoint another admin first.',
    retryable: false,
  },
  LAST_OWNER: {
    title: 'Transfer ownership first',
    message: 'A Circle always needs an owner. Hand it to another member before leaving.',
    retryable: false,
  },
  LIMIT_REACHED: { title: 'Limit reached', message: 'This is full for now.', retryable: false },
  INVITE_INVALID: {
    title: 'That code didn’t work',
    message: 'Check the code and try again, or ask for a new invite.',
    retryable: false,
  },
  INVITE_EXPIRED: {
    title: 'This invite expired',
    message: 'Invites last seven days. Ask the person who invited you for a new one.',
    retryable: false,
  },
  RATE_LIMITED: { title: 'Slow down a little', message: 'Too many attempts. Try again in a few minutes.', retryable: true },
  LIVE_PAYMENTS_DISABLED: {
    title: 'Rewards aren’t live',
    message: 'Uplift doesn’t collect or pay out money. Reward previews are only available in Demo Mode.',
    retryable: false,
  },
  EMAIL_NOT_VERIFIED: {
    title: 'Verify your email',
    message: 'Open the link we emailed you, then sign in.',
    retryable: false,
  },
  INVALID_CREDENTIALS: { title: 'That didn’t match', message: 'Check your email and password and try again.', retryable: false },
  EMAIL_IN_USE: { title: 'Email already registered', message: 'Try signing in, or reset your password.', retryable: false },
  WEAK_PASSWORD: { title: 'Choose a stronger password', message: 'Use at least 8 characters.', retryable: false },
  NETWORK: {
    title: 'You’re offline',
    message: 'We couldn’t reach Uplift. Check your connection and try again.',
    retryable: true,
  },
  UNEXPECTED_RESPONSE: {
    title: 'Something didn’t look right',
    message: 'The server sent a response this version of the app doesn’t understand. Try updating the app.',
    retryable: false,
  },
  UNKNOWN: { title: 'Something went wrong', message: 'Please try again.', retryable: true },
};

export function describeError(error: unknown): ErrorCopy & { code: ErrorCode } {
  const appError = toAppError(error);
  const copy = COPY[appError.code];
  const detail = appError.code === 'VALIDATION' && appError.message !== 'VALIDATION' ? appError.message : null;
  return { code: appError.code, title: copy.title, message: detail ?? copy.message, retryable: copy.retryable };
}

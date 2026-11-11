/**
 * Diagnostics. Never pass screenshots, signed URLs, passwords, tokens or chat
 * text here: only an event name and a small, safe context. Values that look
 * like URLs or long tokens are scrubbed anyway.
 */
type SafeValue = string | number | boolean | null | undefined;

function scrub(value: SafeValue): SafeValue {
  if (typeof value !== 'string') return value;
  if (/^https?:\/\//i.test(value) || /^(data|blob|file):/i.test(value)) return '[url]';
  if (value.length > 80) return `${value.slice(0, 24)}…[${value.length}]`;
  return value;
}

function write(level: 'info' | 'warn' | 'error', event: string, context?: Record<string, SafeValue>): void {
  if (process.env.NODE_ENV === 'test') return;
  const safe: Record<string, SafeValue> = {};
  for (const [key, value] of Object.entries(context ?? {})) safe[key] = scrub(value);
  console[level](`[uplift] ${event}`, safe);
}

export const log = {
  info: (event: string, context?: Record<string, SafeValue>) => write('info', event, context),
  warn: (event: string, context?: Record<string, SafeValue>) => write('warn', event, context),
  error: (event: string, context?: Record<string, SafeValue>) => write('error', event, context),
};

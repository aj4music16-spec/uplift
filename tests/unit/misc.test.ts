import {
  AppError,
  daysLeftLabel,
  describeError,
  extractInviteCode,
  formatDateKey,
  formatDateRange,
  formatDateTime,
  formatInviteCode,
  formatMinutes,
  formatRelative,
  formatValue,
  initials,
  inviteCodeFromBytes,
  isWellFormedInviteCode,
  normalizeInviteCode,
  possessiveDay,
  relativeDay,
  toAppError,
  ERROR_CODES,
} from '@/domain';

describe('invite codes', () => {
  it('normalises what people type', () => {
    expect(normalizeInviteCode(' k7m2-9xqp-4tla ')).toBe('K7M29XQP4T1A');
    expect(normalizeInviteCode('O0o-iIl')).toBe('000111');
    expect(formatInviteCode('k7m29xqp4t1a')).toBe('K7M2-9XQP-4T1A');
  });

  it('checks the shape without revealing anything about validity', () => {
    expect(isWellFormedInviteCode('K7M2-9XQP-4T1A')).toBe(true);
    expect(isWellFormedInviteCode('K7M2-9XQP')).toBe(false);
    expect(isWellFormedInviteCode('K7M2-9XQP-4T1U')).toBe(false); // U is not in the alphabet
  });

  it('builds codes from random bytes and reads them back from links', () => {
    const code = inviteCodeFromBytes(Uint8Array.from([0, 1, 31, 32, 255, 10, 11, 12, 13, 14, 15, 16]));
    expect(code).toHaveLength(12);
    expect(isWellFormedInviteCode(code)).toBe(true);
    expect(extractInviteCode(`uplift://invite/${code}`)).toBe(code);
    expect(extractInviteCode('https://example.test/invite/k7m2-9xqp-4t1a?x=1')).toBe('K7M29XQP4T1A');
    expect(() => inviteCodeFromBytes(new Uint8Array(4))).toThrow(RangeError);
  });
});

describe('formatting', () => {
  it('formats date keys as calendar dates regardless of device zone', () => {
    expect(formatDateKey('2026-11-03')).toBe('Tue, Nov 3');
    expect(formatDateKey('2026-11-03', { weekday: false })).toBe('Nov 3');
    expect(formatDateRange('2026-11-03', '2026-11-09')).toBe('Nov 3 – Nov 9');
    expect(relativeDay('2026-11-09', '2026-11-10')).toBe('Yesterday');
    expect(relativeDay('2026-11-10', '2026-11-10')).toBe('Today');
    expect(relativeDay('2026-11-11', '2026-11-10')).toBe('Tomorrow');
    expect(relativeDay('2026-11-03', '2026-11-10')).toBe('Tue, Nov 3');
    expect(possessiveDay('2026-11-09', '2026-11-10')).toBe('yesterday’s');
    expect(possessiveDay('2026-11-06', '2026-11-10')).toBe('Nov 6');
  });

  it('formats instants in the challenge zone', () => {
    expect(formatDateTime('2026-11-11T17:00:00Z', 'America/New_York')).toBe('Wed, Nov 11, 12:00 PM');
  });

  it('formats durations, values and relative times', () => {
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(95)).toBe('1h 35m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatValue('screen_time', 'lte', 'minutes', 95)).toBe('1h 35m');
    expect(formatValue('pushups', 'gte', 'reps', 32)).toBe('32 reps');
    expect(formatValue('prayer', 'bool', 'check-in', 1)).toBe('Yes');
    const now = new Date('2026-11-10T12:00:00Z');
    expect(formatRelative('2026-11-10T14:05:00Z', now)).toBe('in 2h 5m');
    expect(formatRelative('2026-11-10T11:55:00Z', now)).toBe('5m ago');
    expect(formatRelative('2026-11-13T12:00:00Z', now)).toBe('in 3 days');
    expect(daysLeftLabel('2026-11-08', '2026-11-09')).toBe('2 days left');
    expect(daysLeftLabel('2026-11-09', '2026-11-09')).toBe('Last day');
    expect(daysLeftLabel('2026-11-10', '2026-11-09')).toBe('Ended');
    expect(initials('Dad')).toBe('D');
    expect(initials('Mia Chen')).toBe('MC');
  });
});

describe('errors', () => {
  it('has user-facing copy for every code', () => {
    for (const code of ERROR_CODES) {
      const copy = describeError(new AppError(code));
      expect(copy.title.length).toBeGreaterThan(3);
      expect(copy.message.length).toBeGreaterThan(10);
    }
  });

  it('maps server exception messages and network failures', () => {
    expect(toAppError(new Error('DEADLINE_PASSED')).code).toBe('DEADLINE_PASSED');
    expect(toAppError(new TypeError('Network request failed')).code).toBe('NETWORK');
    expect(toAppError(new Error('boom')).code).toBe('UNKNOWN');
    expect(toAppError('weird').code).toBe('UNKNOWN');
  });

  it('shows specific validation messages when the server sends one', () => {
    expect(describeError(new AppError('VALIDATION', 'Required days can’t be more than the 7 scheduled days.')).message).toBe(
      'Required days can’t be more than the 7 scheduled days.',
    );
  });
});

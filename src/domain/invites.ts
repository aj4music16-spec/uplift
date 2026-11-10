/**
 * Invitation codes.
 *
 * A code is 12 characters from a 32-symbol alphabet (60 bits of randomness),
 * shown as XXXX-XXXX-XXXX. The server generates it, returns it exactly once and
 * stores only a SHA-256 hash. Redemption is authenticated, rate limited and
 * atomic with the membership insert.
 */

/** Crockford base32: no I, L, O or U, so codes survive being read aloud or typed. */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_CODE_LENGTH = 12;

/** Uppercases, drops separators and maps look-alike characters (O→0, I/L→1). */
export function normalizeInviteCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

export function isWellFormedInviteCode(input: string): boolean {
  const code = normalizeInviteCode(input);
  if (code.length !== INVITE_CODE_LENGTH) return false;
  for (const char of code) if (!INVITE_ALPHABET.includes(char)) return false;
  return true;
}

export function formatInviteCode(input: string): string {
  const code = normalizeInviteCode(input);
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** Builds a code from random bytes (5 bits per character). Used by the demo repository. */
export function inviteCodeFromBytes(bytes: Uint8Array): string {
  if (bytes.length < INVITE_CODE_LENGTH) throw new RangeError('Not enough random bytes for an invite code');
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) out += INVITE_ALPHABET[(bytes[i] ?? 0) & 31];
  return out;
}

export function inviteLink(code: string): string {
  return `uplift://invite/${normalizeInviteCode(code)}`;
}

/** Pulls a code out of a pasted link or a typed code. */
export function extractInviteCode(input: string): string {
  const match = /invite\/([0-9A-Za-z-]+)/.exec(input);
  return normalizeInviteCode(match?.[1] ?? input);
}

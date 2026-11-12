import { z } from 'zod';

/** Deliberately loose: the auth server is the real judge of an address. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 8;

export const emailField = z
  .string()
  .refine((value) => value.trim().length > 0, 'Enter your email address.')
  .refine((value) => value.trim().length === 0 || EMAIL_PATTERN.test(value.trim()), 'Enter a valid email address, like name@example.com.');

export const newPasswordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(72, 'Use 72 characters or fewer.');

export const codeField = z
  .string()
  .refine((value) => /^\d{6}$/.test(value.trim()), 'Enter the 6-digit code from the email.');

export const signUpSchema = z.object({ email: emailField, password: newPasswordField });
export type SignUpValues = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({ email: emailField, password: z.string().min(1, 'Enter your password.') });
export type SignInValues = z.infer<typeof signInSchema>;

export const verifySchema = z.object({ email: emailField, code: codeField });
export type VerifyValues = z.infer<typeof verifySchema>;

export const resetRequestSchema = z.object({ email: emailField });
export type ResetRequestValues = z.infer<typeof resetRequestSchema>;

export const resetConfirmSchema = z
  .object({ code: codeField, password: newPasswordField, confirm: z.string() })
  .refine((values) => values.password === values.confirm, { message: 'The passwords don’t match.', path: ['confirm'] });
export type ResetConfirmValues = z.infer<typeof resetConfirmSchema>;

/** Keeps only digits, at most six, so a pasted "123 456" still works. */
export function cleanCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, 6);
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

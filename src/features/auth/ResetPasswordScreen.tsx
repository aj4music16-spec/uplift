import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Mail } from '@/components/icons';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { useToast } from '@/components/Toast';
import { useApp } from '@/data/AppProvider';

import { space } from '@/theme/tokens';

import { useAfterSignInHref } from './afterSignIn';
import { AuthUnavailable } from './AuthUnavailable';
import { ErrorBanner } from './ErrorBanner';
import { FormTextField } from './FormTextField';
import { PasswordToggle } from './PasswordToggle';
import { cleanCode, MIN_PASSWORD_LENGTH, resetConfirmSchema, resetRequestSchema, type ResetConfirmValues, type ResetRequestValues } from './schemas';
import { useAuthTask } from './useAuthTask';

const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Two steps: request a code by email, then enter the code with a new
 * password. A correct recovery code starts a session, so this screen does not
 * redirect on sign-in by itself: it waits until the password is changed.
 */
export function ResetPasswordScreen() {
  const router = useRouter();
  const toast = useToast();
  const { auth } = useApp();
  const afterSignIn = useAfterSignInHref();
  const request = useAuthTask();
  const confirm = useAuthTask();
  const [email, setEmail] = useState<string | null>(null);
  const [codeAccepted, setCodeAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const requestForm = useForm<ResetRequestValues>({ resolver: zodResolver(resetRequestSchema), defaultValues: { email: '' } });
  const confirmForm = useForm<ResetConfirmValues>({ resolver: zodResolver(resetConfirmSchema), defaultValues: { code: '', password: '', confirm: '' } });

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!auth) return <AuthUnavailable title="Reset password" />;

  const sendCode = async (address: string) => {
    const result = await request.run(() => auth.requestPasswordReset(address));
    if (result.ok) {
      setEmail(address);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  };

  const submitRequest = requestForm.handleSubmit((values) => sendCode(values.email.trim().toLowerCase()));

  const submitConfirm = confirmForm.handleSubmit(async (values) => {
    if (!email) return;
    const result = await confirm.run(async () => {
      // The code is single-use: once accepted, a retry only resends the new password.
      if (!codeAccepted) {
        await auth.verifyCode({ email, code: values.code.trim(), purpose: 'recovery' });
        setCodeAccepted(true);
      }
      await auth.updatePassword(values.password);
    });
    if (result.ok) {
      toast.success('Password changed', 'You’re signed in with your new password.');
      router.replace(afterSignIn);
    }
  });

  if (!email) {
    return (
      <Screen
        header={<NavHeader />}
        footer={<Button label="Send reset code" loading={request.pending} onPress={() => void submitRequest()} testID="reset-send-code" />}>
        <TitleBlock title="Reset your password" subtitle="Enter your account email. We’ll send a 6-digit code to set a new password." />
        <ErrorBanner error={request.error} />
        <FormTextField
          control={requestForm.control}
          name="email"
          label="Email"
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="send"
          onSubmitEditing={() => void submitRequest()}
          testID="reset-email"
        />
      </Screen>
    );
  }

  return (
    <Screen
      header={<NavHeader onLeading={() => (codeAccepted ? router.back() : setEmail(null))} />}
      footer={<Button label="Set new password" loading={confirm.pending} onPress={() => void submitConfirm()} testID="reset-submit" />}>
      <TitleBlock title="Choose a new password" subtitle={`If ${email} has an account, a 6-digit code is on its way.`} />
      <Banner icon={Mail} message="The code can take a minute to arrive. Check your spam folder too." />
      <ErrorBanner error={confirm.error ?? request.error} />
      <View style={{ gap: space.lg }}>
        {codeAccepted ? null : (
          <FormTextField
            control={confirmForm.control}
            name="code"
            label="6-digit code"
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="next"
            transform={cleanCode}
            testID="reset-code"
          />
        )}
        <FormTextField
          control={confirmForm.control}
          name="password"
          label="New password"
          helper={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          trailing={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} testID="reset-toggle-password" />}
          testID="reset-password"
        />
        <FormTextField
          control={confirmForm.control}
          name="confirm"
          label="Repeat new password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submitConfirm()}
          testID="reset-password-confirm"
        />
      </View>
      {codeAccepted ? null : (
        <Button
          label={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          variant="secondary"
          size="md"
          disabled={cooldown > 0}
          disabledReason="You can ask for another code in a moment"
          loading={request.pending}
          onPress={() => void sendCode(email)}
          testID="reset-resend"
        />
      )}
    </Screen>
  );
}

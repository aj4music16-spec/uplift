import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { CircleCheck } from '@/components/icons';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { useApp } from '@/data/AppProvider';
import { SplashView } from '@/features/shell/SplashView';
import { space } from '@/theme/tokens';

import { useAfterSignInHref } from './afterSignIn';
import { AuthUnavailable } from './AuthUnavailable';
import { ErrorBanner } from './ErrorBanner';
import { FormTextField } from './FormTextField';
import { cleanCode, firstParam, verifySchema, type VerifyValues } from './schemas';
import { useAuthTask } from './useAuthTask';

const RESEND_COOLDOWN_SECONDS = 60;

/** Confirms a new account with the 6-digit code from the verification email. */
export function VerifyScreen() {
  const params = useLocalSearchParams<{ email?: string; sent?: string }>();
  const initialEmail = firstParam(params.email) ?? '';
  const { auth, phase } = useApp();
  const afterSignIn = useAfterSignInHref();
  const task = useAuthTask();
  const resend = useAuthTask();
  // A code was just sent (sign-up or "send code"), so start in cooldown.
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [resent, setResent] = useState(firstParam(params.sent) === '1');
  const { control, handleSubmit, getValues, trigger } = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    defaultValues: { email: initialEmail, code: '' },
  });

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!auth) return <AuthUnavailable title="Verify your email" />;
  if (phase === 'loading') return <SplashView />;
  // A correct code starts a session; the next stop is profile setup.
  if (phase === 'signed_in') return <Redirect href={afterSignIn} />;

  const submit = handleSubmit(async (values) => {
    await task.run(() => auth.verifyCode({ email: values.email.trim().toLowerCase(), code: values.code.trim(), purpose: 'signup' }));
  });

  const resendCode = async () => {
    if (!(await trigger('email'))) return;
    const email = getValues('email').trim().toLowerCase();
    const result = await resend.run(() => auth.resendVerification(email));
    if (result.ok) {
      setResent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  };

  return (
    <Screen
      header={<NavHeader />}
      footer={<Button label="Verify email" loading={task.pending} onPress={() => void submit()} testID="verify-submit" />}>
      <TitleBlock
        title="Check your email"
        subtitle={initialEmail ? `We sent a 6-digit code to ${initialEmail}. Enter it here to confirm your account.` : 'Enter the email you signed up with and the 6-digit code we sent to it.'}
      />
      {resent && !resend.error ? <Banner tone="positive" icon={CircleCheck} message="A new code is on its way. It can take a minute to arrive; check your spam folder too." /> : null}
      <ErrorBanner error={task.error ?? resend.error} />
      <View style={{ gap: space.lg }}>
        {initialEmail ? null : (
          <FormTextField
            control={control}
            name="email"
            label="Email"
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            testID="verify-email"
          />
        )}
        <FormTextField
          control={control}
          name="code"
          label="6-digit code"
          placeholder="123456"
          keyboardType="number-pad"
          maxLength={6}
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          returnKeyType="go"
          transform={cleanCode}
          onSubmitEditing={() => void submit()}
          autoFocus={!!initialEmail}
          testID="verify-code"
        />
      </View>
      <Button
        label={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
        variant="secondary"
        size="md"
        disabled={cooldown > 0}
        disabledReason="You can ask for another code in a moment"
        loading={resend.pending}
        onPress={() => void resendCode()}
        testID="verify-resend"
      />
    </Screen>
  );
}

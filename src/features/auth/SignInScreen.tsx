import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Banner } from '@/components/Badges';
import { Button } from '@/components/Button';
import { Mail } from '@/components/icons';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { useApp } from '@/data/AppProvider';
import { toAppError } from '@/domain/errors';
import { SplashView } from '@/features/shell/SplashView';
import { space } from '@/theme/tokens';

import { useAfterSignInHref } from './afterSignIn';
import { AuthUnavailable } from './AuthUnavailable';
import { ErrorBanner } from './ErrorBanner';
import { FormTextField } from './FormTextField';
import { PasswordToggle } from './PasswordToggle';
import { signInSchema, type SignInValues } from './schemas';
import { useAuthTask } from './useAuthTask';

export function SignInScreen() {
  const router = useRouter();
  const { auth, phase } = useApp();
  const afterSignIn = useAfterSignInHref();
  const task = useAuthTask();
  const resend = useAuthTask();
  const [showPassword, setShowPassword] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const { control, handleSubmit, getValues } = useForm<SignInValues>({ resolver: zodResolver(signInSchema), defaultValues: { email: '', password: '' } });

  if (!auth) return <AuthUnavailable title="Sign in" />;
  if (phase === 'loading') return <SplashView />;
  // The AppProvider flips to signed_in once the session exists.
  if (phase === 'signed_in') return <Redirect href={afterSignIn} />;

  const submit = handleSubmit(async (values) => {
    const email = values.email.trim().toLowerCase();
    setUnverifiedEmail(null);
    const result = await task.run(() => auth.signIn({ email, password: values.password }));
    if (!result.ok && toAppError(result.error).code === 'EMAIL_NOT_VERIFIED') {
      task.setError(null);
      setUnverifiedEmail(email);
    }
  });

  const verifyNow = async () => {
    const email = unverifiedEmail ?? getValues('email').trim().toLowerCase();
    const result = await resend.run(() => auth.resendVerification(email));
    if (result.ok) router.push(`/verify?email=${encodeURIComponent(email)}&purpose=signup&sent=1`);
  };

  return (
    <Screen
      header={<NavHeader />}
      footer={<Button label="Sign in" loading={task.pending} onPress={() => void submit()} testID="sign-in-submit" />}>
      <TitleBlock title="Welcome back" subtitle="Sign in with your email and password." />
      {unverifiedEmail ? (
        <Banner
          tone="warning"
          icon={Mail}
          title="Verify your email first"
          message={`${unverifiedEmail} hasn’t been confirmed yet. We’ll send a new 6-digit code so you can finish.`}
          action={
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              <Button label="Send code and verify" variant="secondary" size="sm" fullWidth={false} loading={resend.pending} onPress={() => void verifyNow()} testID="sign-in-verify" />
              <Button
                label="I have a code"
                variant="ghost"
                size="sm"
                fullWidth={false}
                onPress={() => router.push(`/verify?email=${encodeURIComponent(unverifiedEmail)}&purpose=signup`)}
              />
            </View>
          }
        />
      ) : null}
      <ErrorBanner error={task.error ?? resend.error} />
      <View style={{ gap: space.lg }}>
        <FormTextField
          control={control}
          name="email"
          label="Email"
          placeholder="name@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="username"
          returnKeyType="next"
          testID="sign-in-email"
        />
        <FormTextField
          control={control}
          name="password"
          label="Password"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          trailing={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} testID="sign-in-toggle-password" />}
          testID="sign-in-password"
        />
      </View>
      <View style={{ gap: space.xs }}>
        <Button label="Forgot password?" variant="ghost" size="md" onPress={() => router.push('/reset-password')} testID="sign-in-forgot" />
        <Button label="Create an account" variant="ghost" size="md" onPress={() => router.replace('/sign-up')} testID="sign-in-to-sign-up" />
      </View>
    </Screen>
  );
}

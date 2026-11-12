import { zodResolver } from '@hookform/resolvers/zod';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { View } from 'react-native';

import { Button } from '@/components/Button';
import { NavHeader, Screen, TitleBlock } from '@/components/Screen';
import { Text } from '@/components/Text';
import { useApp } from '@/data/AppProvider';
import { SplashView } from '@/features/shell/SplashView';
import { space } from '@/theme/tokens';

import { useAfterSignInHref } from './afterSignIn';
import { AuthUnavailable } from './AuthUnavailable';
import { ErrorBanner } from './ErrorBanner';
import { FormTextField } from './FormTextField';
import { PasswordToggle } from './PasswordToggle';
import { MIN_PASSWORD_LENGTH, signUpSchema, type SignUpValues } from './schemas';
import { useAuthTask } from './useAuthTask';

export function SignUpScreen() {
  const router = useRouter();
  const { auth, phase } = useApp();
  const afterSignIn = useAfterSignInHref();
  const task = useAuthTask();
  const [showPassword, setShowPassword] = useState(false);
  const { control, handleSubmit } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema), defaultValues: { email: '', password: '' } });

  if (!auth) return <AuthUnavailable title="Create account" />;
  if (phase === 'loading') return <SplashView />;
  if (phase === 'signed_in') return <Redirect href={afterSignIn} />;

  const submit = handleSubmit(async (values) => {
    const email = values.email.trim().toLowerCase();
    const result = await task.run(() => auth.signUp({ email, password: values.password }));
    if (result.ok && result.value.needsVerification) {
      router.push(`/verify?email=${encodeURIComponent(email)}&purpose=signup`);
    }
    // Without verification a session starts and this screen redirects itself.
  });

  return (
    <Screen
      header={<NavHeader />}
      footer={<Button label="Create account" loading={task.pending} onPress={() => void submit()} testID="sign-up-submit" />}>
      <TitleBlock title="Create your account" subtitle="Use an email you can open now: we’ll send a 6-digit code to confirm it." />
      <ErrorBanner
        error={task.error}
        action={
          task.error && (task.error as { code?: string }).code === 'EMAIL_IN_USE' ? (
            <Button label="Sign in instead" variant="secondary" size="sm" fullWidth={false} onPress={() => router.replace('/sign-in')} />
          ) : undefined
        }
      />
      <View style={{ gap: space.lg }}>
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
          testID="sign-up-email"
        />
        <FormTextField
          control={control}
          name="password"
          label="Password"
          helper={`At least ${MIN_PASSWORD_LENGTH} characters.`}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          trailing={<PasswordToggle visible={showPassword} onToggle={() => setShowPassword((v) => !v)} testID="sign-up-toggle-password" />}
          testID="sign-up-password"
        />
      </View>
      <Button label="I already have an account" variant="ghost" size="md" onPress={() => router.replace('/sign-in')} testID="sign-up-to-sign-in" />
      <Text variant="caption" color="textSecondary">
        Your email is only used to sign in. It’s never shown to other members.
      </Text>
    </Screen>
  );
}

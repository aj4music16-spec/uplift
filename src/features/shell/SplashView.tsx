import { ActivityIndicator, View } from 'react-native';

import { Wordmark } from '@/components/brand/Wordmark';
import { colors, space } from '@/theme/tokens';

export function SplashView() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: space.xxl }} accessibilityLabel="Loading Uplift">
      <Wordmark height={40} />
      <ActivityIndicator color={colors.ink} />
    </View>
  );
}

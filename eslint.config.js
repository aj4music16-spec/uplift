// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'node_modules/*', '.expo/*', 'supabase/functions/*', 'e2e/.artifacts/*', 'coverage/*'],
  },
  {
    // The domain layer must stay pure: no React, React Native, Expo or
    // backend imports. Both repositories and the SQL conformance tests rely
    // on it being runnable anywhere.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-native', 'expo*', '@supabase/*', '@/data/*', '@/features/*', '@/components/*', '@/lib/*'], message: 'src/domain must stay pure.' },
          ],
        },
      ],
    },
  },
]);

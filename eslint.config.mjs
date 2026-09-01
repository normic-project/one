import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'artifacts/**', 'cache/**', 'src/generated/**', 'reports/**', 'playwright-report/**', 'test-results/**'] },
  js.configs.recommended,
  { files: ['**/*.cjs', 'api/**/*.js', 'test/**/*.js', 'e2e/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.mocha } } },
  { files: ['supabase/functions/**/*.mjs'], languageOptions: { globals: globals.worker } },
  { files: ['e2e/**/*.js'], languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended.map(config => ({ ...config, files: ['src/**/*.ts', 'src/**/*.tsx', 'vite.config.ts'] })),
  { files: ['src/**/*.{ts,tsx}'], languageOptions: { globals: globals.browser }, plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules } }
);

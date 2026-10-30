import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['**/dist/**', '**/node_modules/**', '.agents/**', '.codex/**'] }, js.configs.recommended, ...tseslint.configs.recommended, {
  files: ['**/*.{ts,tsx,mjs}'],
  languageOptions: { globals: { window: 'readonly', document: 'readonly', console: 'readonly', process: 'readonly', URL: 'readonly', setTimeout: 'readonly', fetch: 'readonly' } },
}, {
  files: ['packages/{world,voxel,chalk,forge}/**/*.ts'],
  rules: { 'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Use the event seed.' }, { object: 'Date', property: 'now', message: 'Use the simulation clock.' }] },
});

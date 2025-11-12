import js from '@eslint/js';
import globals from 'globals';
import pluginPrettier from 'eslint-plugin-prettier';
import { FlatCompat } from '@eslint/eslintrc';
import { defineConfig } from 'eslint/config';

const compat = new FlatCompat();

export default defineConfig([
  ...compat.extends('plugin:prettier/recommended'),
  {
    ignores: ['node_modules', 'dist', 'build'],
    plugins: { prettier: pluginPrettier },
    rules: {
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
]);

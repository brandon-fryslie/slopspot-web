import js from "@eslint/js"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import reactPlugin from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"

export default [
  {
    ignores: [
      "build/**",
      ".react-router/**",
      ".wrangler/**",
      ".next/**",
      "node_modules/**",
      "worker-configuration.d.ts",
      "services/**/dist/**",
      "services/**/node_modules/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["app/**/*.{ts,tsx}", "workers/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        Env: "readonly",
        ExecutionContext: "readonly",
        ExportedHandler: "readonly",
        Request: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
        fetch: "readonly",
        console: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react": reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // TypeScript already validates these; the base ESLint rules don't
      // understand TS type-vs-value namespaces or ambient declarations.
      "no-undef": "off",
      "no-redeclare": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
    settings: { react: { version: "detect" } },
  },
  {
    // Node scripts — plain .mjs, no TypeScript, no JSX, no Worker bindings.
    // process and console are the only Node ambient globals these scripts use;
    // everything else arrives via explicit `import ... from 'node:...'` ESM imports.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
    },
  },
  {
    // The black-box smoke suite + the prober wrapper: node + fetch context (no app
    // bindings, no JSX). tsParser handles both .ts and .mjs; no-undef off mirrors the
    // app block (tsc -b validates the .ts via tsconfig.node; the .mjs prober is tested).
    files: ["smoke/**/*.{ts,mjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        Response: "readonly",
        Headers: "readonly",
        URL: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
]

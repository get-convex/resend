import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { files: ["src/**/*.{js,mjs,cjs,ts,tsx}"] },
  {
    ignores: [
      "dist/**",
      "eslint.config.js",
      "example/eslint.config.js",
      "**/_generated/",
      "node10stubs.mjs",
    ],
  },
  {
    languageOptions: {
      globals: globals.worker,
      parser: tseslint.parser,

      parserOptions: {
        project: ["./tsconfig.json", "./example/tsconfig.json"],
        tsconfigRootDir: ".",
      },
    },
  },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "separate-type-imports",
        },
      ],
      "eslint-comments/no-unused-disable": "off",

      // allow (_arg: number) => {} and const _foo = 1;
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];

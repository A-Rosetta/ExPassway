import js from "@eslint/js";
import globals from "globals";

const commonRules = {
  ...js.configs.recommended.rules,
  "no-control-regex": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-useless-assignment": "off",
  "preserve-caught-error": "off",
  "no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
    },
  ],
};

export default [
  {
    ignores: [
      ".cloudflare-dist/**",
      ".wrangler/**",
      "assets/vendor/**",
      "assets/exam-question-images/**",
      "node_modules/**",
    ],
  },
  {
    files: ["cloudflare/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.serviceworker,
      },
    },
    rules: commonRules,
  },
  {
    files: ["scripts/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    rules: commonRules,
  },
  {
    files: ["tools/**/*.{js,mjs,cjs}", "tests/**/*.{js,mjs,cjs}", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: commonRules,
  },
];

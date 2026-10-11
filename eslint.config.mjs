import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

/** Flat ESLint config for the TanStack Start app-builder template. */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-test/**",
      "dist-win/**",
      "ui-build/**",
      "agent-build/**",
      ".output/**",
      ".vercel/**",
      ".nitro/**",
      ".tanstack/**",
      ".vinxi/**",
      ".turbo/**",
      ".cache/**",
      "artifacts/**",
      "screenshots/**",
      "runs/**",
      "**/.anvil/runs/**",
      "anvil-test/**",
      "attachments/**",
      "data/**",
      "node_modules/**",
      "src/routeTree.gen.ts",
      "src/lib/anvil-skills.generated.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // These callbacks execute in isolated iframe fixtures where the canvas
    // runtime installs window.Anvil; the Node test driver has no such global.
    files: ["scripts/canvas.browser.mjs", "scripts/reported-problems.browser.mjs"],
    languageOptions: { globals: { Anvil: "readonly" } },
  },
  {
    files: ["public/python-check-worker.js"],
    languageOptions: { globals: globals.worker },
  },
  {
    // Electron loads this sandboxed preload as CommonJS, including require("electron").
    files: ["electron/preload.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Disable rules that conflict with Prettier formatting.
  prettier,
);

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "out/**",
      "dist/**",
      "node_modules/**",
      "test/contract/fixtures/**",
      ".claude/**",
      "firmware/**",
      "tools/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ["src/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "electron",
              message: "src/server must run without Electron.",
            },
          ],
          patterns: [
            {
              group: ["**/main/**", "**/preload/**", "**/renderer/**"],
              message: "src/server must not depend on app layers.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/renderer/**/*.tsx", "src/renderer/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // React calls whatever an effect returns as its cleanup. A value such
          // as the Promise Chromium's scrollIntoView returns crashes on unmount.
          selector:
            "CallExpression[callee.name=/^use(Layout)?Effect$/] > ArrowFunctionExpression[expression=true]",
          message:
            "Give effects a block body so they return nothing or a cleanup.",
        },
      ],
    },
  },
);

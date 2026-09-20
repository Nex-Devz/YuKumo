import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "examples/", "coverage/"] },
  {
    extends: [
      ...tseslint.configs.recommended,
    ],
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/strict-boolean-expressions": "warn",
      "no-console": "warn",
    },
  },
  {
    // Tests routinely cast partial mocks to `any` and probe private state;
    // strict typing there fights the intent instead of catching real bugs.
    files: ["src/**/*.test.ts", "src/bench.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "no-console": "off",
    },
  },
);

# Contributing to Yukumo

Thanks for your interest in contributing to **Yukumo**. Contributions of every
size are welcome — bug fixes, new features, documentation, and performance work
all move the project forward.

---

## Code of Conduct

Please be respectful, friendly, and inclusive across issues, pull requests, and
discussions. Harassment or exclusionary behaviour of any kind is not tolerated.

---

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 18.0.0 or newer (or [Bun](https://bun.sh/) 1.0.0+)
- [npm](https://www.npmjs.com/) (used in CI) or [bun](https://bun.sh/)

### 1. Fork and clone

```bash
git clone https://github.com/Nex-Devz/YuKumo.git
cd YuKumo
```

### 2. Install dependencies

```bash
npm install
```

---

## Development Workflow

### Scripts

| Command | Description |
|---|---|
| `npm run build` | Build ESM, CJS, and `.d.ts` outputs with `tsup` |
| `npm run typecheck` | Strict type validation (`tsc --noEmit`) |
| `npm test` | Run the Vitest unit test suite |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with a coverage report |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint and apply autofixes |
| `npm run format` | Format source with Prettier |
| `npm run format:check` | Verify formatting without writing |

---

## Testing Guidelines

Before opening a pull request, make sure the same checks CI runs pass locally:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

When adding a feature or fixing a bug:

1. Add or update tests in `src/**/*.test.ts`.
2. Keep the public TypeScript surface free of `any`.
3. Add clear JSDoc on public functions, classes, and options so JavaScript
   users get rich autocomplete.

---

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/). Keep each
commit small and focused.

```
feat: add custom filter preset
fix: retry player node failover on transient error
docs: clarify NodeLink auto-detection
```

---

## Submitting a Pull Request

1. **Create a feature branch**

   ```bash
   git checkout -b feat/my-feature
   ```

2. **Commit your changes** using Conventional Commits.

3. **Push to your fork**

   ```bash
   git push -u origin feat/my-feature
   ```

4. **Open a pull request** against the default branch with a summary of the
   changes and evidence that the checks above pass.

---

Thanks for helping make Yukumo better.

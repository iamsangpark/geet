# CLAUDE.md

## Overview

`geet` is a personal interactive Git wrapper CLI (TypeScript, Node.js ESM, `"type": "module"`). Install with `npm link` to make `geet` available globally. Requires Node.js 24+.

The source is TypeScript in `src/`, compiled by `tsc` to `dist/` (gitignored); `bin` points at `dist/index.js`. Source files import siblings with the `.ts` extension — `rewriteRelativeImportExtensions` rewrites them to `.js` on emit — and type-only imports must use `import type` (`verbatimModuleSyntax`). `npm install` runs `prepare`, which builds, so `npm link` works on a fresh clone; rebuild with `npm run build` after editing source.

## Commands

```sh
npm run build         # tsc -> dist/ (also runs on npm install via `prepare`)
npm start             # node dist/index.js (needs a build)
npm run dev           # node src/index.ts — runs source directly via Node type stripping, no build
npm link              # global install
geet <command>        # after npm link

npm run typecheck     # tsc --noEmit (src + test)
npm run lint          # oxlint
npm run format        # oxfmt (write); `format:check` to verify
npm test              # vitest run (tests live in test/)
```

CI runs typecheck, lint, format:check, tests, and build on every PR. A husky pre-commit hook (`.husky/pre-commit`, installed by `prepare`) runs `lint-staged` (oxlint + oxfmt write on staged `*.ts`, re-staging the formatted files) and then a full typecheck.

## Architecture

```
src/
├── index.ts          # CLI entry point: commander subcommand registration + omelette autocompletion
├── config.ts         # Config loader: ~/.geet/config → .env → .env.local → process.env
├── errors.ts         # GeetError (carries .gitMessage) + error helpers
├── gitUtils.ts       # All git operations (via execa) — the only file that shells out to git
├── herdrUtils.ts     # herdr CLI calls (via execa) + HERDR_ENV detection
├── prompts.ts        # @clack/prompts wrappers + guardCancel() pattern
└── commands/
    ├── checkout.ts
    ├── stash.ts
    ├── worktree.ts
    ├── copy.ts
    ├── config.ts
    └── mergeRelease.ts

test/                 # vitest unit tests (gitUtils, config, prompts, errors)
```

**Data flow:** `index.ts` registers commands and delegates to `commands/*.ts`. Commands call `gitUtils.ts` for git operations and `prompts.ts` for interactive UI. Config values are imported from `config.ts` by commands that need them.

**Key patterns:**

- Every `@clack/prompts` result must be passed through `guardCancel()` from `prompts.ts` — ESC/Ctrl+C resolves to a cancel Symbol, and `guardCancel()` exits cleanly.
- Errors thrown from commands propagate to the top-level catch in `index.ts`, which prints `err.gitMessage || err.message` to stderr. Throw `GeetError` (from `errors.ts`) for errors intended to display a clean user-facing message — it sets `.gitMessage`. Use `userMessage(err)` to read that message from an `unknown` caught value.
- `omelette` (CJS-only) is imported via `createRequire`. Its `init()` must be called before `program.parseAsync()` — it intercepts tab-completion env vars and exits early without running commander.

## Configuration

`config.ts` exports `WORKTREE_BASE`, `BRANCH_PREFIX`, `SYMLINK_PATHS`, `HERDR_MODE` and `WORKTREE_LIST_SIZE`, loaded from (lowest → highest priority):

1. `~/.geet/config`
2. `.env`
3. `.env.local`
4. `process.env`

`GEET_WORKTREE_LIST_SIZE` (default `10`, `0` = show all) sets how many rows searchable selection lists show; ESC cancels them.

`GEET_HERDR` (`off` default | `prompt` | `auto`, exported as `HERDR_MODE`) enables herdr integration. It only applies when `HERDR_ENV=1` (inside a herdr pane); `worktree new/add/list` then open the worktree via `herdr worktree open` instead of spawning a shell, and `remove`/`prune` offer to close the matching herdr workspaces (never the one geet runs in). All herdr CLI calls live in `src/herdrUtils.ts` (the only file that shells out to herdr); on any herdr failure geet falls back to `spawnShellIn`.

After `worktree new` / `worktree add` (unless `--no-init` is passed), the tool runs init scripts in order: `~/.geet/init/default.sh` (always, if executable), then `~/.geet/init/<repo-name>.sh` (repo-specific, if executable). Both are run in the new worktree directory. Use `geet config init-script --default` (or `-d`) to scaffold `default.sh` and `geet config init-script` to scaffold the repo-specific one.

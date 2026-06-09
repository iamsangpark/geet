# CLAUDE.md

## Overview

`geet` is a personal interactive Git wrapper CLI (Node.js ESM, `"type": "module"`). Install with `npm link` to make `geet` available globally. Requires Node.js 24+.

## Commands

```sh
npm start           # run via node
node src/index.js   # direct invocation
npm link            # global install
geet <command>      # after npm link
```

No test suite or lint script exists in this project.

## Architecture

```
src/
├── index.js          # CLI entry point: commander subcommand registration + omelette autocompletion
├── config.js         # Config loader: ~/.geetrc → .env → .env.local → process.env
├── gitUtils.js       # All git operations (via execa) — the only file that shells out to git
├── prompts.js        # @clack/prompts wrappers + guardCancel() pattern
└── commands/
    ├── checkout.js
    ├── stash.js
    ├── worktree.js
    └── mergeRelease.js
```

**Data flow:** `index.js` registers commands and delegates to `commands/*.js`. Commands call `gitUtils.js` for git operations and `prompts.js` for interactive UI. Config values are imported from `config.js` by commands that need them.

**Key patterns:**
- Every `@clack/prompts` result must be passed through `guardCancel()` from `prompts.js` — ESC/Ctrl+C resolves to a cancel Symbol, and `guardCancel()` exits cleanly.
- Errors thrown from commands propagate to the top-level catch in `index.js`, which prints `err.gitMessage || err.message` to stderr. Set `err.gitMessage` on errors intended to display a clean user-facing message.
- `omelette` (CJS-only) is imported via `createRequire`. Its `init()` must be called before `program.parseAsync()` — it intercepts tab-completion env vars and exits early without running commander.

## Configuration

`config.js` exports `WORKTREE_BASE`, `BRANCH_PREFIX`, and `SYMLINK_PATHS`, loaded from (lowest → highest priority):
1. `~/.geetrc`
2. `.env`
3. `.env.local`
4. `process.env`

After `worktree add` or `worktree smart-add`, the tool runs init scripts in order: `~/.geet/init/default.sh` (always, if executable), then `~/.geet/init/<repo-name>.sh` (repo-specific, if executable). Both are run in the new worktree directory. Use `geet config default-init-script` to scaffold `default.sh` and `geet config init-script` to scaffold the repo-specific one.

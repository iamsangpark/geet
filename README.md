# geet — Git Productivity CLI

A personal, interactive Git wrapper with safety guards, worktree management, and shell autocompletion.

## Requirements

- Node.js 24+

## Installation

```sh
git clone <repo>
cd geet
npm install
npm link
```

## Usage

```
geet <command> [options]
```

---

## Commands

### `geet checkout [branch]` · alias: `co`

Checkout a branch with uncommitted-change protection.

- If you have uncommitted changes, prompts you to either **stash first** or **force checkout**.
- If the branch doesn't exist locally or remotely, it is created automatically (`git checkout -b`).

```sh
geet checkout main
geet co feature/my-new-thing   # creates branch if it doesn't exist
geet co                        # prompts for branch name interactively
```

---

### `geet stash` · alias: `sts`

Stash your changes, **including untracked files** (they are staged with `git add -A` first).

Prompts for a stash message unless `-m` is given. Subcommands: `pop`, `list`.

| Flag                   | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `-m, --message <msg>`  | Stash message (skips the prompt).                                   |
| `-k, --keep-untracked` | Leave untracked files in the working tree instead of stashing them. |

```sh
geet stash
geet sts -m "WIP: refactoring auth module"
geet sts -k
```

---

### `geet stash pop`

Pop the most recent stash with an uncommitted-change guard.

If you have uncommitted changes, prompts you to **add all & stash them first**, **stash them first**, or **pop anyway**.

```sh
geet stash pop
geet sts pop
```

---

### `geet stash list`

Interactively select a stash entry to pop from a list.

- Displays all stashes with their index, message, and date.
- Applies the same uncommitted-change guard as `stash pop`.
- Press **ESC** or **Ctrl+C** to cancel without modifying anything.

```sh
geet stash list
geet sts list
```

---

### `geet worktree` · alias: `wt`

Manage git worktrees. Running `geet worktree` with no subcommand is the same as `geet worktree list`.

Subcommands: `new`, `add`, `list`, `remove`, `prune`, `rename`, `link-fix`, `pull`, `merge`

After a worktree is created (`new` / `add`), geet:

1. Copies the worktree path to the clipboard.
2. Symlinks any configured `GEET_SYMLINK_PATHS` from the main worktree.
3. Opens a shell inside the new worktree — or, when running inside [herdr](https://herdr.dev) with `GEET_HERDR` enabled, opens it as a herdr workspace (see [herdr integration](#herdr-integration)).
4. Runs the [init scripts](#init-scripts) (unless `--no-init`) — in the new herdr workspace's terminal if one was opened, otherwise in your current terminal just before the shell starts.

---

### `geet worktree new`

Interactively create a **new branch and worktree** at a standardized path:

```
<GEET_WORKTREE_BASE>/<projectName>/<jiraName>-<description>
```

The branch is named `<GEET_BRANCH_PREFIX><jiraName>-<description>`. Spaces in the description become `_`, and the Jira ticket is optional. If the repo has a [project mapping](#geet-config-project-map), the project name prompt is pre-filled.

| Flag                    | Description                               |
| ----------------------- | ----------------------------------------- |
| `-f, --folder <dir>`    | Target directory for the new worktree.    |
| `-b, --branch <branch>` | Branch name for the new worktree.         |
| `--no-init`             | Skip running init scripts after creation. |

Pass both `-f` and `-b` to skip all prompts.

```sh
geet wt new
# → Project name:   my-app
# → Jira ticket:    PROJ-1234
# → Description:    add login page
# → Creates worktree at ~/worktrees/my-app/PROJ-1234-add_login_page

geet wt new -f ~/worktrees/my-app/hotfix -b hotfix --no-init
```

---

### `geet worktree add`

Check out an **existing local branch** as a new worktree. Lists local branches that aren't already checked out, then asks for the project name. The folder name is the branch name with `GEET_BRANCH_PREFIX` stripped.

| Flag        | Description                               |
| ----------- | ----------------------------------------- |
| `--no-init` | Skip running init scripts after creation. |

```sh
geet wt add
```

---

### `geet worktree list`

Select a worktree (with fuzzy search). Its path is copied to the clipboard and a new shell is opened inside it — or, with [herdr integration](#herdr-integration) enabled, its herdr workspace is opened or switched to. Worktrees that already have an open herdr workspace are marked `herdr ●`.

```sh
geet wt list
geet wt            # same thing
```

---

### `geet worktree remove`

Interactively select one or more worktrees (other than the main one) to remove; none are selected by default. Worktrees with uncommitted or untracked files are listed and you can reset them (`git reset --hard` + `git clean -fd`) before removing, or skip them. With herdr enabled, it also asks whether to close open workspaces for the removed worktrees. Failures on individual worktrees are reported without stopping the rest.

| Flag                    | Description                                                             |
| ----------------------- | ----------------------------------------------------------------------- |
| `--path <dir>`          | Remove the worktree at this path (skips the selection prompt).          |
| `-b, --branch <branch>` | Remove the worktree with this branch name (skips the selection prompt). |

With `--path` and/or `--branch` the matching worktree is removed directly; if both are given they must match the same worktree. It errors if nothing matches or the match is the main worktree. The reset-or-skip and herdr-workspace prompts still apply.

If you remove the worktree you're currently in, it is removed last and geet moves you somewhere valid afterwards — see [removing the current worktree](#removing-the-current-worktree).

```sh
geet wt remove
geet wt remove --path ~/worktrees/my-app/PROJ-1234-add_login_page
geet wt remove --branch sp/PROJ-1234-add_login_page
```

---

### `geet worktree prune`

Fetches from origin (pruning deleted remote branches), then finds worktrees whose remote-tracking branch no longer exists. You pick which of those to remove. It uses the same checks as `remove`: one question about closing open herdr workspaces, and a reset-or-skip prompt for each worktree with blocking changes. Failures on individual worktrees are reported without stopping the rest.

```sh
geet wt prune
```

---

### `geet worktree rename`

Interactively rename a worktree: moves its folder and switches it to a new branch, then offers to delete the old branch. Prompts are pre-filled from the current path.

```sh
geet wt rename
```

---

### `geet worktree link-fix`

Re-create the `GEET_SYMLINK_PATHS` symlinks from the main worktree into a selected worktree, replacing any existing links.

```sh
geet wt link-fix
```

---

### `geet worktree pull`

Select a worktree and pull the latest changes for its branch.

```sh
geet wt pull
```

---

### `geet worktree merge`

Select a worktree branch to merge into the **current branch**. If you have uncommitted changes, prompts you to add all & stash, stash, or merge anyway.

| Flag         | Description                                          |
| ------------ | ---------------------------------------------------- |
| `-p, --pull` | Pull the selected branch from origin before merging. |

```sh
geet wt merge
geet wt merge -p
```

---

### `geet copy` · alias: `cp`

Copy information about the current repo to the clipboard. Subcommands: `path` (alias `worktree`), `jira`, `branch`.

| Command                                 | Copies                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `geet copy path` / `geet copy worktree` | The folder path of the worktree you're in (replaces the old `geet wt copy-path`)                                    |
| `geet copy jira`                        | The Jira ticket key (e.g. `PROJ-1234`), found in the current branch name or, failing that, the worktree folder name |
| `geet copy branch`                      | The current branch name                                                                                             |

```sh
geet cp path
geet cp jira
geet cp branch
```

---

### `geet config` · alias: `cfg`

Manage geet configuration and init scripts. Subcommands: `list`, `global`, `local`, `set`, `init-script`, `project-map`.

#### `geet config list`

List config values currently set, with the file each comes from. Pass `-a` / `--all` to list every option (set or not) in separate `LOCAL` (`.env.local`) and `REPO` (`.env`) sections, followed by `GLOBAL` (`~/.geet/config`).

#### `geet config global`

Interactively create or update `~/.geet/config`. Existing values are pre-filled.

#### `geet config local`

Create or update `.env` or `.env.local` in the current directory.

#### `geet config set`

Update a single config key in a file you choose.

#### `geet config init-script`

Scaffold the init script for the current repo at `~/.geet/init/<repo-name>.sh`. Lets you start from a stub or copy/move an existing script, marks it executable, and opens it in `$EDITOR`. If the script already exists you can override, edit, or skip.

| Flag            | Description                                                       |
| --------------- | ----------------------------------------------------------------- |
| `-d, --default` | Scaffold `~/.geet/init/default.sh` (runs for every repo) instead. |

```sh
geet config init-script -d   # default script
geet config init-script      # this repo's script
```

#### `geet config project-map`

Set (or clear) the project name for the current repo. It's stored in `~/.geet/project-map.json` and used by `worktree new` / `add` to pre-fill the project name prompt.

---

### `geet merge-release <source> <dest>`

Pull both branches and merge `<source>` into `<dest>`, then show the diff vs origin.

```sh
geet merge-release release/1.2.0 develop
```

**Options:**

| Flag              | Description                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `-n, --no-change` | Merge using `-X ours --no-commit` — stages the merge for manual inspection without committing. |

```sh
geet merge-release release/1.2.0 develop -n
geet merge-release release/1.2.0 develop --no-change
```

---

## Configuration

Config values are loaded from the following sources, lowest to highest priority:

1. `~/.geet/config` — global defaults
2. `.env` — project-level defaults
3. `.env.local` — local overrides (don't commit)
4. `process.env` — shell environment

| Key                       | Default       | Description                                                                                                                                          |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEET_WORKTREE_BASE`      | `~/worktrees` | Base directory for worktrees created by `worktree new` / `add`.                                                                                      |
| `GEET_BRANCH_PREFIX`      | _(none)_      | Prefix prepended to branch names created by `worktree new`.                                                                                          |
| `GEET_SYMLINK_PATHS`      | _(none)_      | Comma-separated relative paths symlinked from the main worktree into each new worktree.                                                              |
| `GEET_HERDR`              | `off`         | `off`, `prompt` or `auto` — open worktrees as [herdr](https://herdr.dev) workspaces. See [herdr integration](#herdr-integration).                    |
| `GEET_WORKTREE_LIST_SIZE` | `10`          | Rows visible in searchable selection lists (worktrees, branches). `0` shows every item instead of a scrolling list. Press ESC to cancel a selection. |

```sh
# ~/.geet/config
GEET_WORKTREE_BASE=~/dev/worktrees
GEET_BRANCH_PREFIX=sp/
GEET_SYMLINK_PATHS=.env.local,node_modules
GEET_HERDR=prompt
GEET_WORKTREE_LIST_SIZE=10
```

Use `geet config global|local|set` to edit these interactively.

### herdr integration

When `GEET_HERDR` is `prompt` or `auto` **and** geet is running inside a herdr pane (herdr sets `HERDR_ENV=1`), the end of `worktree new` / `add` / `list` opens the worktree as a herdr workspace instead of spawning a nested shell:

- `prompt` asks each time ("Open in new herdr workspace" / "Switch to herdr workspace" / "Open shell here"); `auto` always opens the workspace.
- If a workspace for the worktree is already open, geet switches to it rather than creating a duplicate. `worktree list` marks such worktrees with `herdr ●`.
- `worktree remove` / `prune` ask whether to also close the removed worktrees' herdr workspaces (never the one geet is running in).
- Init scripts run inside the newly opened workspace (in its first pane) rather than in the terminal you ran geet from. Their output and any failure show up there.
- Outside herdr, with `GEET_HERDR=off`, or if the `herdr` command fails, geet falls back to the normal shell. Use `GEET_HERDR=off geet wt …` for a one-off override.

#### Removing the current worktree

When `worktree remove` / `prune` removes the worktree geet is running in, it steps into the base (main) worktree first, removes the current one last, then:

- **In herdr, base worktree workspace open:** switches to it and closes the current workspace.
- **In herdr, base workspace not open, other workspaces exist:** switches to the first other workspace and closes the current one.
- **In herdr with no other workspaces, or not in herdr:** opens a shell in the base worktree folder.

If removing the current worktree fails, you stay where you are.

### Init scripts

After `worktree new` / `worktree add`, geet runs these in the new worktree directory (each only if it exists and is executable). With herdr, they run in the new workspace's terminal; otherwise in your current terminal before the shell opens:

1. `~/.geet/init/default.sh` — for every repo
2. `~/.geet/init/<repo-name>.sh` — for the repo only

Scaffold them with `geet config init-script -d` and `geet config init-script`. Skip them with `--no-init`.

---

## Shell Autocompletion

Install tab completion for bash/zsh:

```sh
geet --setup-completion
source ~/.zshrc    # or ~/.bashrc
```

Remove it:

```sh
geet --cleanup-completion
```

After setup, pressing Tab after `geet ` will complete subcommands and aliases.

---

## Project Structure

```
src/
├── index.ts              # CLI entry point (commander + omelette completions)
├── config.ts             # Config loader (~/.geet/config → .env → .env.local → process.env)
├── utils/
│   ├── errors.ts         # GeetError + error helpers
│   ├── git.ts            # All git operations via execa
│   ├── clipboard.ts      # copyToClipboard
│   ├── commander.ts      # Subcommand help/description helpers
│   └── stashChanges.ts   # Shared "stash current changes" flow
├── prompts/              # @clack/prompts UI layer, one file per domain
│   ├── common.ts
│   └── checkout.ts, stash.ts, worktree.ts, config.ts
└── commands/
    ├── checkout.ts
    ├── stash.ts
    ├── copy.ts
    ├── mergeRelease.ts
    ├── worktree/         # index, create, list, remove, rename, linkFix, pullMerge
    │   └── utils/        # herdr (herdr CLI calls), openWorktree, initScripts, shell,
    │                     # symlinks, naming, loadWorktrees
    └── config/           # index, list, edit, projectMap, initScript
        └── utils/        # editor, stubs

test/                     # vitest unit tests (mirrors src/)
```

---

## Development

Source is TypeScript in `src/`, compiled by `tsc` to `dist/` (which `geet` runs).

```sh
npm install          # also builds, via the `prepare` script
npm run build        # compile src/ → dist/ (re-run after editing source)
npm run dev          # run src/index.ts directly, no build
npm run typecheck    # tsc --noEmit (src + test)
npm run lint         # oxlint
npm run format       # oxfmt (use `format:check` to verify only)
npm test             # vitest
```

CI runs typecheck, lint, format check, tests and build on every pull request and on pushes to `main`.

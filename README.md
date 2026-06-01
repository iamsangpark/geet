# geet — Git Productivity CLI

A personal, interactive Git wrapper with safety guards, worktree management, and shell autocompletion.

## Requirements

- Node.js 24+

## Installation

```sh
git clone <repo>
cd git-util
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

### `geet stash [message]` · alias: `sts`

Stash your uncommitted changes with an optional description.

Subcommands: `pop`, `list`

```sh
geet stash
geet sts "WIP: refactoring auth module"
```

---

### `geet stash pop`

Pop the most recent stash with an uncommitted-change guard.

If you have uncommitted changes, prompts you to either **stash them first** or **pop anyway**.

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

Manage git worktrees.

Subcommands: `add`, `smart-add`, `list`

---

### `geet worktree add <branch> <dir>`

Add a git worktree at the given path for the given branch.

```sh
geet worktree add feature/my-branch ~/projects/my-branch
geet wt add feature/my-branch ~/projects/my-branch
```

---

### `geet worktree smart-add`

Interactively create a worktree with a standardized path.

Prompts for three values and formats the path as:

```
~/worktrees/<projectName>/<jiraName>-<description>
```

```sh
geet wt smart-add
# → Project name:   my-app
# → Jira ticket:    PROJ-1234
# → Description:    add-login-page
# → Creates worktree at ~/worktrees/my-app/PROJ-1234-add-login-page
```

---

### `geet worktree list`

List all active worktrees and take an action on the selected one:

1. **Copy path to clipboard** — copies the absolute path for use elsewhere.
2. **Open a new shell session** — spawns a shell inside the worktree directory.

```sh
geet wt list
```

---

### `geet merge-release <source> <dest>`

Pull both branches and merge `<source>` into `<dest>`, then show the diff vs origin.

```sh
geet merge-release release/1.2.0 develop
```

**Options:**

| Flag | Description |
|---|---|
| `-n, --no-change` | Merge using `-X ours --no-commit` — stages the merge for manual inspection without committing. |

```sh
geet merge-release release/1.2.0 develop -n
geet merge-release release/1.2.0 develop --no-change
```

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
├── index.js              # CLI entry point (commander + omelette)
├── gitUtils.js           # All git operations via execa
├── prompts.js            # @clack/prompts helpers
└── commands/
    ├── checkout.js
    ├── stash.js
    ├── worktree.js
    └── mergeRelease.js
```

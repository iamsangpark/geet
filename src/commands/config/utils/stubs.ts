export const REPO_STUB_CONTENT = `#!/usr/bin/env bash
set -euo pipefail

# Runs in the new worktree directory after \`geet worktree new\` / \`geet worktree add\`.
# The current directory is the newly-created worktree.
#
# Examples:
#   npm install
#   cp ../.env.local .env.local
`;

export const DEFAULT_STUB_CONTENT = `#!/usr/bin/env bash
set -euo pipefail

# Default init script — runs for every repo before any repo-specific init script.
# The current directory is the newly-created worktree.
#
# Examples:
#   echo "Worktree created at: $PWD"
#   git config core.hooksPath ~/.githooks
`;

/**
 * gitUtils.js
 * All git subprocess operations via execa.
 * Every exported function returns structured data or throws an Error
 * with a `.gitMessage` property containing a clean, user-facing message.
 */

import { execa } from 'execa';

// ── Error Handling ────────────────────────────────────────────────────────────

/**
 * Converts a raw execa error into a clean Error with a .gitMessage property.
 * Strips ANSI codes and noisy prefixes like "error:" and "fatal:".
 */
function parseGitError(err) {
  const raw = err.stderr || err.stdout || err.message || 'Unknown git error';
  const clean = raw
    .replace(/\x1b\[[0-9;]*m/g, '') // strip ANSI color codes
    .split('\n')
    .map(line => line.replace(/^(error|fatal|hint):\s*/i, '').trim())
    .filter(Boolean)
    .join('\n');

  const error = new Error(clean);
  error.gitMessage = clean;
  return error;
}

/**
 * Run a git command. Returns stdout string on success, throws cleaned Error on failure.
 */
async function git(args, options = {}) {
  try {
    const result = await execa('git', args, { reject: true, ...options });
    return result.stdout;
  } catch (err) {
    throw parseGitError(err);
  }
}

// ── Status & Branch ───────────────────────────────────────────────────────────

/**
 * Returns the raw `git status --porcelain` output.
 * Empty string means the working tree is clean.
 */
export async function getUncommittedChanges() {
  return git(['status', '--porcelain']);
}

/**
 * Returns the name of the currently checked-out branch.
 */
export async function getCurrentBranch() {
  return git(['rev-parse', '--abbrev-ref', 'HEAD']);
}

/**
 * Checks whether a branch exists locally and/or remotely.
 * @returns {{ local: boolean, remote: boolean }}
 */
export async function branchExists(branch) {
  const local = await execa('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { reject: false });
  const remote = await execa('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], { reject: false });
  return {
    local: local.exitCode === 0,
    remote: remote.exitCode === 0,
  };
}

/**
 * Fetches all remotes.
 */
export async function fetchAll() {
  return git(['fetch', '--all']);
}

/**
 * Fetches and prunes stale remote-tracking branches.
 */
export async function fetchPrune() {
  return git(['fetch', '--prune']);
}

/**
 * Returns true if origin/<branch> still exists as a remote-tracking ref.
 * Call after fetchPrune() so the local refs are up to date.
 */
export async function remoteTrackingExists(branch) {
  const result = await execa(
    'git', ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
    { reject: false },
  );
  return result.exitCode === 0;
}

// ── Checkout ─────────────────────────────────────────────────────────────────

export async function checkoutBranch(branch) {
  return git(['checkout', branch]);
}

export async function checkoutNewBranch(branch) {
  return git(['checkout', '-b', branch]);
}

export async function checkoutForce(branch) {
  return git(['checkout', '--force', branch]);
}

// ── Stash ─────────────────────────────────────────────────────────────────────

/**
 * Stashes current changes. If `message` is provided, uses it as the stash description.
 */
/**
 * Stages all changes including untracked files (`git add -A`).
 */
export async function gitAddAll() {
  return git(['add', '-A']);
}

export async function stashSave(message) {
  if (message) {
    return git(['stash', 'push', '-m', message]);
  }
  return git(['stash']);
}

export async function stashPop() {
  return git(['stash', 'pop']);
}

export async function stashApply(index) {
  return git(['stash', 'apply', `stash@{${index}}`]);
}

export async function stashPopIndex(index) {
  return git(['stash', 'pop', `stash@{${index}}`]);
}

/**
 * Lists all stashes.
 * @returns {Array<{ index: number, name: string, date: string, ref: string }>}
 */
export async function listStashes() {
  const stdout = await git(['stash', 'list', '--format=%gd|%s|%ci']);
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [ref, name, date] = line.split('|');
      const match = ref.match(/\{(\d+)\}/);
      const index = match ? parseInt(match[1], 10) : 0;
      return { index, name: name?.trim() ?? '', date: date?.trim() ?? '', ref: ref?.trim() ?? '' };
    });
}

// ── Worktree ──────────────────────────────────────────────────────────────────

/**
 * Adds a worktree. If the branch doesn't exist locally, creates it with -b.
 */
export async function addWorktree(branch, dir) {
  const { local } = await branchExists(branch);
  if (local) {
    return git(['worktree', 'add', dir, branch]);
  }
  return git(['worktree', 'add', '-b', branch, dir]);
}

/**
 * Removes a worktree at the given path.
 */
export async function removeWorktree(dir) {
  return git(['worktree', 'remove', dir]);
}

/**
 * Lists all worktrees by parsing `git worktree list --porcelain`.
 * @returns {Array<{ path: string, branch: string, commit: string, isMain: boolean }>}
 */
export async function listWorktrees() {
  const stdout = await git(['worktree', 'list', '--porcelain']);
  if (!stdout.trim()) return [];

  const blocks = stdout.trim().split('\n\n').filter(Boolean);
  return blocks.map((block, i) => {
    const lines = block.trim().split('\n');
    const entry = {};
    for (const line of lines) {
      const spaceIdx = line.indexOf(' ');
      if (spaceIdx === -1) {
        entry[line.toLowerCase()] = true; // bare flags like "bare"
      } else {
        const key = line.slice(0, spaceIdx).toLowerCase();
        const val = line.slice(spaceIdx + 1);
        entry[key] = val;
      }
    }
    return {
      path: entry.worktree ?? '',
      commit: entry.head ?? '',
      branch: entry.branch?.replace('refs/heads/', '') ?? '(detached HEAD)',
      isMain: i === 0,
    };
  });
}

// ── Merge / Pull ──────────────────────────────────────────────────────────────

/**
 * Pulls the latest changes for a branch using fetch + merge of origin/<branch>.
 * Stays on the current branch — does not switch.
 */
export async function pullBranch(branch) {
  await fetchAll();
  const current = await getCurrentBranch();

  if (current !== branch) {
    // Update via remote-tracking ref without checking out
    await git(['fetch', 'origin', `${branch}:${branch}`]);
  } else {
    await git(['merge', `origin/${branch}`]);
  }
}

/**
 * Merges the source branch into the current branch.
 * @param {string} source
 * @param {{ noCommit?: boolean, strategy?: 'ours' | null }} opts
 */
export async function mergeBranch(source, opts = {}) {
  const args = ['merge'];
  if (opts.strategy === 'ours') args.push('-X', 'ours');
  if (opts.noCommit) args.push('--no-commit');
  args.push(source);
  return git(args);
}

/**
 * Returns the diff between the local branch and its origin counterpart.
 */
export async function getDiffVsOrigin(branch) {
  return git(['diff', `origin/${branch}`]);
}

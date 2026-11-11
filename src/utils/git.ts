/**
 * utils/git.ts
 * All git subprocess operations via execa.
 * Every exported function returns structured data or throws an Error
 * with a `.gitMessage` property containing a clean, user-facing message.
 */

import path from 'path';
import { execa, type Options } from 'execa';
import { GeetError } from './errors.ts';

export interface Worktree {
  path: string;
  commit: string;
  branch: string;
  isMain: boolean;
}

export interface Stash {
  index: number;
  name: string;
  date: string;
  ref: string;
}

// ── Error Handling ────────────────────────────────────────────────────────────

/**
 * Converts a raw execa error into a clean Error with a .gitMessage property.
 * Strips ANSI codes and noisy prefixes like "error:" and "fatal:".
 */
export function parseGitError(err: unknown): GeetError {
  const e = err as { stderr?: string; stdout?: string; message?: string };
  const raw = e.stderr || e.stdout || e.message || 'Unknown git error';
  const clean = raw
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, '') // strip ANSI color codes
    .split('\n')
    .map((line) => line.replace(/^(error|fatal|hint):\s*/i, '').trim())
    .filter(Boolean)
    .join('\n');

  return new GeetError(clean);
}

/**
 * Run a git command. Returns stdout string on success, throws cleaned Error on failure.
 */
async function git(args: string[], options: Options = {}): Promise<string> {
  try {
    const result = await execa('git', args, { reject: true, ...options });
    return String(result.stdout);
  } catch (err) {
    throw parseGitError(err);
  }
}

// ── Status & Branch ───────────────────────────────────────────────────────────

/**
 * Returns the raw `git status --porcelain` output.
 * Empty string means the working tree is clean.
 */
export async function getUncommittedChanges(): Promise<string> {
  return git(['status', '--porcelain']);
}

/**
 * Returns the name of the currently checked-out branch.
 */
export async function getCurrentBranch(): Promise<string> {
  return git(['rev-parse', '--abbrev-ref', 'HEAD']);
}

/**
 * Checks whether a branch exists locally and/or remotely.
 */
export async function branchExists(branch: string): Promise<{ local: boolean; remote: boolean }> {
  const local = await execa('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    reject: false,
  });
  const remote = await execa('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], {
    reject: false,
  });
  return {
    local: local.exitCode === 0,
    remote: remote.exitCode === 0,
  };
}

/**
 * Fetches all remotes.
 */
export async function fetchAll(): Promise<string> {
  return git(['fetch', '--all']);
}

/**
 * Fetches and prunes stale remote-tracking branches.
 */
export async function fetchPrune(): Promise<string> {
  return git(['fetch', '--prune']);
}

/**
 * Returns true if origin/<branch> still exists as a remote-tracking ref.
 * Call after fetchPrune() so the local refs are up to date.
 */
export async function remoteTrackingExists(branch: string): Promise<boolean> {
  const result = await execa(
    'git',
    ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${branch}`],
    { reject: false },
  );
  return result.exitCode === 0;
}

/**
 * Points a branch's upstream at origin/<branch> by writing branch.<name>.remote/merge
 * directly. Unlike `git branch --set-upstream-to`, this works before the branch exists
 * on origin, so a later `git push` + `git pull` need no further setup.
 */
export async function setUpstreamToOrigin(branch: string): Promise<void> {
  await git(['config', `branch.${branch}.remote`, 'origin']);
  await git(['config', `branch.${branch}.merge`, `refs/heads/${branch}`]);
}

// ── Checkout ─────────────────────────────────────────────────────────────────

export async function checkoutBranch(branch: string) {
  return git(['checkout', branch]);
}

export async function checkoutNewBranch(branch: string) {
  return git(['checkout', '-b', branch]);
}

export async function checkoutForce(branch: string) {
  return git(['checkout', '--force', branch]);
}

// ── Stash ─────────────────────────────────────────────────────────────────────

/**
 * Stages all changes including untracked files (`git add -A`).
 */
export async function gitAddAll(dir?: string) {
  return git(['add', '-A'], { cwd: dir });
}

/**
 * Stashes current changes. If `message` is provided, uses it as the stash description.
 * `dir` runs it in another worktree.
 */
export async function stashSave(message?: string, dir?: string) {
  if (message) {
    return git(['stash', 'push', '-m', message], { cwd: dir });
  }
  return git(['stash'], { cwd: dir });
}

export async function stashPop() {
  return git(['stash', 'pop']);
}

export async function stashPopIndex(index: number) {
  return git(['stash', 'pop', `stash@{${index}}`]);
}

/**
 * Lists all stashes.
 */
export async function listStashes(): Promise<Stash[]> {
  const stdout = await git(['stash', 'list', '--format=%gd|%s|%ci']);
  if (!stdout.trim()) return [];

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', name = '', date = ''] = line.split('|');
      const match = ref.match(/\{(\d+)\}/);
      const index = match?.[1] ? parseInt(match[1], 10) : 0;
      return { index, name: name.trim(), date: date.trim(), ref: ref.trim() };
    });
}

// ── Worktree ──────────────────────────────────────────────────────────────────

/**
 * Returns local branch names that are not already checked out in any worktree.
 */
export async function listLocalBranches(): Promise<string[]> {
  const result = await git(['branch', '--format=%(refname:short)']);
  const all = result
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
  const worktrees = await listWorktrees();
  const inUse = new Set(worktrees.map((w) => w.branch));
  return all.filter((b) => !inUse.has(b));
}

/**
 * Adds a worktree. If the branch doesn't exist locally, creates it with -b.
 */
export async function addWorktree(branch: string, dir: string) {
  const { local } = await branchExists(branch);
  if (local) {
    return git(['worktree', 'add', dir, branch]);
  }
  return git(['worktree', 'add', '-b', branch, dir]);
}

/**
 * Removes a worktree at the given path.
 */
export async function removeWorktree(dir: string) {
  return git(['worktree', 'remove', dir]);
}

/**
 * Returns the `git status --porcelain` lines for a worktree, listing individual
 * untracked files. Empty array means nothing would block `worktree remove`.
 */
export async function getWorktreeChanges(dir: string): Promise<string[]> {
  const stdout = await git(['status', '--porcelain', '--untracked-files=all'], { cwd: dir });
  return stdout.split('\n').filter(Boolean);
}

/**
 * Discards all tracked changes and deletes untracked files in a worktree.
 * Gitignored files are left alone (they don't block `worktree remove`).
 */
export async function resetWorktree(dir: string) {
  await git(['reset', '--hard'], { cwd: dir });
  await git(['clean', '-fd'], { cwd: dir });
}

/**
 * Moves a worktree from oldPath to newPath.
 */
export async function moveWorktree(oldPath: string, newPath: string) {
  return git(['worktree', 'move', oldPath, newPath]);
}

/**
 * Creates a new branch and checks it out inside an existing worktree directory.
 */
export async function checkoutNewBranchInDir(branch: string, dir: string) {
  return git(['checkout', '-b', branch], { cwd: dir });
}

/**
 * Deletes a local branch (requires it to be fully merged, use -D to force).
 */
export async function deleteBranch(branch: string, force = false) {
  return git(['branch', force ? '-D' : '-d', branch]);
}

/**
 * Returns true if a local branch with this name exists (no network access).
 */
export async function localBranchExists(branch: string): Promise<boolean> {
  const result = await execa('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    reject: false,
  });
  return result.exitCode === 0;
}

/**
 * Returns every local branch name, including ones checked out in a worktree.
 */
export async function listAllLocalBranches(): Promise<string[]> {
  const result = await git(['branch', '--format=%(refname:short)']);
  return result
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
}

// ── Branch base ───────────────────────────────────────────────────────────────
// Git doesn't track which branch another was created from, so geet records it in the
// repo's local config as `branch.<name>.geet-base` (shared by all worktrees, never pushed).

const baseKey = (branch: string) => `branch.${branch}.geet-base`;

/**
 * The base branch geet recorded for `branch`, or undefined when none is set.
 */
export async function getBranchBase(branch: string): Promise<string | undefined> {
  const result = await execa('git', ['config', '--local', '--get', baseKey(branch)], {
    reject: false,
  });
  const value = result.exitCode === 0 ? String(result.stdout).trim() : '';
  return value || undefined;
}

export async function setBranchBase(branch: string, base: string) {
  return git(['config', '--local', baseKey(branch), base]);
}

/**
 * Best-effort guess from the branch reflog, whose first entry reads
 * "branch: Created from <ref>". Only yields a name when the branch was created from a
 * named branch (not HEAD or a SHA); reflog entries also expire.
 */
export async function guessBranchBase(branch: string): Promise<string | undefined> {
  const result = await execa('git', ['reflog', 'show', '--format=%gs', `refs/heads/${branch}`], {
    reject: false,
  });
  if (result.exitCode !== 0) return undefined;
  const lines = String(result.stdout).split('\n').filter(Boolean);
  const match = /^branch: Created from (.+)$/.exec(lines[lines.length - 1] ?? '');
  const ref = match?.[1]?.trim();
  if (!ref || ref === 'HEAD' || /^[0-9a-f]{7,40}$/.test(ref)) return undefined;
  return ref.replace(/^refs\/heads\//, '');
}

/**
 * Lists all worktrees by parsing `git worktree list --porcelain`.
 */
export async function listWorktrees(): Promise<Worktree[]> {
  const stdout = await git(['worktree', 'list', '--porcelain']);
  if (!stdout.trim()) return [];

  const blocks = stdout.trim().split('\n\n').filter(Boolean);
  return blocks.map((block, i) => {
    const lines = block.trim().split('\n');
    const entry: Record<string, string | true> = {};
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
      path: typeof entry.worktree === 'string' ? entry.worktree : '',
      commit: typeof entry.head === 'string' ? entry.head : '',
      branch:
        typeof entry.branch === 'string'
          ? entry.branch.replace('refs/heads/', '')
          : '(detached HEAD)',
      isMain: i === 0,
    };
  });
}

/**
 * The repo's main worktree (the first entry of `git worktree list`).
 */
export async function getMainWorktree(): Promise<Worktree | undefined> {
  return (await listWorktrees()).find((w) => w.isMain);
}

/**
 * Name of the repo, taken from the main worktree's folder name.
 */
export async function getRepoName(): Promise<string> {
  const main = await getMainWorktree();
  if (!main) throw new GeetError('Could not find main worktree.');
  return path.basename(main.path);
}

// ── Merge / Pull ──────────────────────────────────────────────────────────────

/**
 * Pulls the latest changes for a branch using fetch + merge of origin/<branch>.
 * Stays on the current branch — does not switch.
 */
export async function pullBranch(branch: string): Promise<void> {
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
 * Merges the source branch into the current branch (or, with `dir`, into the branch
 * checked out in that worktree).
 */
export async function mergeBranch(
  source: string,
  opts: { noCommit?: boolean; strategy?: 'ours' | null; dir?: string } = {},
) {
  const args = ['merge'];
  if (opts.strategy === 'ours') args.push('-X', 'ours');
  if (opts.noCommit) args.push('--no-commit');
  args.push(source);
  return git(args, { cwd: opts.dir });
}

/**
 * Fast-forwards a local branch to origin/<branch> (fetching first). Never creates a
 * merge commit: git refuses when the branch has diverged from origin.
 *
 * With `dir` (a worktree that has the branch checked out) it merges `--ff-only` there,
 * since git won't let you update a branch that is checked out in another worktree via
 * `fetch origin branch:branch`. Without it the ref is updated directly, no checkout needed.
 */
export async function fastForwardBranch(branch: string, dir?: string): Promise<void> {
  if (dir) {
    await git(['fetch', 'origin', branch], { cwd: dir });
    await git(['merge', '--ff-only', `origin/${branch}`], { cwd: dir });
  } else {
    await git(['fetch', 'origin', `${branch}:${branch}`]);
  }
}

/**
 * Pushes a local branch to the same-named branch on origin, from any worktree (no checkout
 * needed). Never forced: git refuses when origin has commits the branch lacks.
 */
export async function pushBranch(branch: string): Promise<void> {
  await git(['push', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]);
}

/**
 * Rebases the current branch onto `onto`.
 */
export async function rebaseOnto(onto: string) {
  return git(['rebase', onto]);
}

/**
 * Returns [behind, ahead]: commits in `base` that `branch` lacks, and commits in `branch`
 * that `base` lacks.
 */
export async function countBehindAhead(base: string, branch: string): Promise<[number, number]> {
  const out = await git(['rev-list', '--left-right', '--count', `${base}...${branch}`]);
  const [behind, ahead] = out.split(/\s+/).map(Number);
  return [behind ?? 0, ahead ?? 0];
}

/**
 * Returns the diff between the local branch and its origin counterpart.
 */
export async function getDiffVsOrigin(branch: string) {
  return git(['diff', `origin/${branch}`]);
}

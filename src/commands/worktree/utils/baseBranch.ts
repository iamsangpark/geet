import { GeetError } from '../../../utils/errors.ts';
import {
  fastForwardBranch,
  getBranchBase,
  getCurrentBranch,
  getWorktreeChanges,
  guessBranchBase,
  listAllLocalBranches,
  listWorktrees,
  localBranchExists,
  setBranchBase,
} from '../../../utils/git.ts';
import { logInfo } from '../../../prompts/common.ts';
import { promptSelectBaseBranch } from '../../../prompts/worktree.ts';

export type BaseSource = 'recorded' | 'reflog' | 'selected';

export interface ResolvedBase {
  /** The branch checked out in the current directory. */
  current: string;
  base: string;
  source: BaseSource;
}

/**
 * Returns the current branch, or throws when HEAD is detached (no branch to have a base).
 */
export async function requireCurrentBranch(): Promise<string> {
  const current = await getCurrentBranch();
  if (current === 'HEAD') {
    throw new GeetError('HEAD is detached — check out a branch first.');
  }
  return current;
}

/**
 * Works out the base branch of the current branch:
 *   1. the base recorded in config (`branch.<name>.geet-base`)
 *   2. otherwise the branch it was created from, per the reflog (then recorded)
 *   3. otherwise ask the user to pick one (then recorded)
 */
export async function resolveBase(): Promise<ResolvedBase> {
  const current = await requireCurrentBranch();

  const recorded = await getBranchBase(current);
  if (recorded) {
    if (recorded === current) {
      throw new GeetError(
        `"${current}" is recorded as its own base. Run "geet wt base set" to fix it.`,
      );
    }
    if (!(await localBranchExists(recorded))) {
      throw new GeetError(
        `Base branch "${recorded}" of "${current}" no longer exists locally. ` +
          'Run "geet wt base set" to choose another.',
      );
    }
    return { current, base: recorded, source: 'recorded' };
  }

  const guessed = await guessBranchBase(current);
  if (guessed && guessed !== current && (await localBranchExists(guessed))) {
    await setBranchBase(current, guessed);
    logInfo(`Detected base "${guessed}" from the branch history and recorded it.`);
    return { current, base: guessed, source: 'reflog' };
  }

  const base = await selectBase(current, `No base recorded for "${current}". Select its base:`);
  await setBranchBase(current, base);
  return { current, base, source: 'selected' };
}

/**
 * Asks the user for a base among the other local branches.
 */
export async function selectBase(current: string, message?: string): Promise<string> {
  const branches = (await listAllLocalBranches()).filter((b) => b !== current);
  if (branches.length === 0) {
    throw new GeetError(`There is no other local branch to use as a base for "${current}".`);
  }
  return promptSelectBaseBranch(branches, message);
}

/**
 * Brings the local `base` branch up to date with origin (fast-forward only), even when it
 * is checked out in another worktree. A dirty base worktree is refused unless `force`.
 */
export async function pullBase(base: string, { force = false } = {}): Promise<void> {
  const target = (await listWorktrees()).find((w) => w.branch === base);

  if (target) {
    const changes = await getWorktreeChanges(target.path);
    if (changes.length > 0 && !force) {
      throw new GeetError(
        `"${base}" is checked out in ${target.path}, which has ${changes.length} uncommitted ` +
          'change(s). Commit or stash them there, or pass --force to pull anyway.',
      );
    }
  }

  await fastForwardBranch(base, target?.path);
}

/**
 * commands/worktree/remove.ts
 * Implements:
 *   geet worktree remove   — interactive; multi-select worktrees to delete
 *   geet worktree prune    — fetch, then remove worktrees whose remote branches are gone
 */

import path from 'path';
import { realpath } from 'fs/promises';
import { GeetError, userMessage } from '../../utils/errors.ts';
import {
  type Worktree,
  removeWorktree,
  fetchPrune,
  remoteTrackingExists,
  getWorktreeChanges,
  resetWorktree,
  listWorktrees,
} from '../../utils/git.ts';
import {
  intro,
  outro,
  logInfo,
  logWarn,
  logError,
  spinner,
  promptConfirm,
} from '../../prompts/common.ts';
import {
  promptWorktreeChangesForRemove,
  promptMultiSelectWorktrees,
} from '../../prompts/worktree.ts';
import {
  closeHerdrWorkspace,
  focusHerdrWorkspace,
  herdrMode,
  listHerdrWorkspaces,
} from './utils/herdr.ts';
import { spawnShellIn } from './utils/shell.ts';
import { loadWorktrees } from './utils/loadWorktrees.ts';
import { openHerdrWorkspaces } from './utils/openWorktree.ts';

// ── worktree remove ───────────────────────────────────────────────────────────

interface RemoveOptions {
  path?: string;
  branch?: string;
  this?: boolean;
}

export async function worktreeRemoveAction(options: RemoveOptions = {}) {
  intro('geet wt remove');

  if (options.this && (options.path || options.branch)) {
    throw new GeetError('--this cannot be combined with --path or --branch.');
  }

  const loaded = await loadWorktrees({
    // --this needs the main worktree listed too, to tell "in main" from "in no worktree"
    filter: options.this ? undefined : (w) => !w.isMain,
    emptyMessage: 'No worktrees to remove.',
  });
  if (!loaded) return;

  const mainPath = loaded.all.find((w) => w.isMain)?.path;
  if (options.this) {
    const target = await findCurrentWorktree(loaded.all);
    await removeWorktrees('remove', loaded.candidates, mainPath, [target]);
    return;
  }
  if (options.path || options.branch) {
    const target = await findWorktree(loaded.all, options);
    await removeWorktrees('remove', loaded.candidates, mainPath, [target]);
    return;
  }

  await removeWorktrees('remove', loaded.candidates, mainPath);
}

/**
 * Resolves `--path` / `--branch` to a single removable worktree. When both are
 * given they must agree. The main worktree can never be targeted.
 */
async function findWorktree(all: Worktree[], { path: dir, branch }: RemoveOptions) {
  const wantedDir = dir ? await canonicalPath(dir) : undefined;
  const matches: Worktree[] = [];
  for (const w of all) {
    if (wantedDir && (await canonicalPath(w.path)) !== wantedDir) continue;
    if (branch && w.branch !== branch) continue;
    matches.push(w);
  }

  const description = [dir && `path "${dir}"`, branch && `branch "${branch}"`]
    .filter(Boolean)
    .join(' and ');
  const [target] = matches;
  if (!target) throw new GeetError(`No worktree found with ${description}.`);
  if (target.isMain) throw new GeetError(`Cannot remove the main worktree (${target.path}).`);
  return target;
}

/** The worktree containing the current directory. Fails outside a worktree or in the main one. */
async function findCurrentWorktree(all: Worktree[]) {
  const cwd = await canonicalPath(process.cwd());
  let current: { worktree: Worktree; dir: string } | undefined;
  for (const worktree of all) {
    const dir = await canonicalPath(worktree.path);
    const rel = path.relative(dir, cwd);
    const inside = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    // Prefer the deepest match in case worktrees are nested
    if (inside && (!current || dir.length > current.dir.length)) current = { worktree, dir };
  }
  if (!current) throw new GeetError('The current directory is not inside a worktree.');
  if (current.worktree.isMain) {
    throw new GeetError(`Cannot remove the main worktree (${current.worktree.path}).`);
  }
  return current.worktree;
}

async function canonicalPath(p: string): Promise<string> {
  const resolved = path.resolve(p);
  return realpath(resolved).catch(() => resolved);
}

// ── worktree prune ────────────────────────────────────────────────────────────

export async function worktreePruneAction() {
  intro('geet wt prune');

  const s = spinner();
  s.start('Fetching latest branch information from origin...');
  await fetchPrune();
  s.stop('Fetch complete.');

  const s2 = spinner();
  s2.start('Checking worktrees against remote...');
  const all = await listWorktrees();
  const removable = all.filter((w) => !w.isMain && w.branch !== '(detached HEAD)');

  const stale: Worktree[] = [];
  for (const w of removable) {
    const exists = await remoteTrackingExists(w.branch);
    if (!exists) stale.push(w);
  }
  s2.stop();

  if (stale.length === 0) {
    logInfo('No stale worktrees found — all remote branches are still open.');
    outro('Done.');
    return;
  }

  await removeWorktrees('prune', stale, all.find((w) => w.isMain)?.path);
}

// ── Shared removal flow ───────────────────────────────────────────────────────

interface RemovalPlan {
  worktree: Worktree;
  workspaceId: string | null;
  reset: boolean;
}

const REMOVAL_COMMANDS = {
  remove: { prompt: 'Select worktrees to remove', done: 'Removed', preselected: false },
  prune: { prompt: 'Select worktrees to prune', done: 'Pruned', preselected: true },
};

/**
 * Everything `remove` and `prune` have in common once they know their candidate
 * worktrees: pick which to remove, gather every answer up front, remove them,
 * then report. Failures on individual worktrees don't stop the rest.
 */
async function removeWorktrees(
  command: keyof typeof REMOVAL_COMMANDS,
  candidates: Worktree[],
  mainWorktreePath?: string,
  chosen?: Worktree[],
) {
  const { prompt, done, preselected } = REMOVAL_COMMANDS[command];
  const selected =
    chosen ?? (await promptMultiSelectWorktrees(prompt, candidates, { preselected }));

  // Look up herdr workspaces before removal, while herdr still lists the checkout
  const openWorkspaces = await openHerdrWorkspaces(mainWorktreePath);

  const plans = await planWorktreeRemovals(selected, openWorkspaces);
  if (plans.length === 0) {
    outro('Nothing removed.');
    return;
  }

  // The worktree we're standing in goes last, after stepping out of it, so the
  // other removals (and git itself) never run from a directory that's about to vanish.
  const currentPlan = await findCurrentPlan(plans);
  const ordered = currentPlan ? [...plans.filter((p) => p !== currentPlan), currentPlan] : plans;

  const failed: { worktree: Worktree; message: string }[] = [];
  for (const plan of ordered) {
    try {
      if (plan === currentPlan && mainWorktreePath) process.chdir(mainWorktreePath);
      await executeWorktreeRemoval(plan);
    } catch (err) {
      failed.push({ worktree: plan.worktree, message: userMessage(err) });
    }
  }

  const doneCount = plans.length - failed.length;
  if (failed.length > 0) {
    if (doneCount > 0) logInfo(`${done} ${doneCount} worktree(s).`);
    logError(`Failed to remove ${failed.length} worktree(s):`);
    for (const { worktree, message } of failed) {
      logError(`  ${worktree.branch} (${worktree.path}): ${message}`);
    }
    outro(`geet wt ${command} completed with errors.`);
  } else {
    outro(`${done} ${doneCount} worktree(s).`);
  }

  if (currentPlan && mainWorktreePath && !failed.some((f) => f.worktree === currentPlan.worktree)) {
    await leaveRemovedWorktree(mainWorktreePath, openWorkspaces);
  }
}

/** The plan for the worktree geet was launched from, if it's being removed. */
async function findCurrentPlan(plans: RemovalPlan[]): Promise<RemovalPlan | undefined> {
  const cwd = await realpath(process.cwd()).catch(() => process.cwd());
  for (const plan of plans) {
    const dir = await realpath(plan.worktree.path).catch(() => path.resolve(plan.worktree.path));
    const rel = path.relative(dir, cwd);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return plan;
  }
  return undefined;
}

/**
 * After removing the worktree we were running in, get the user somewhere real:
 *   - in herdr: focus the base worktree's workspace if open, else the first other
 *     workspace, then close the now-dead one (this ends geet, so it comes last)
 *   - otherwise (not in herdr, no other workspace, or herdr failed): a shell in
 *     the base worktree folder
 */
async function leaveRemovedWorktree(mainWorktreePath: string, openWorkspaces: Map<string, string>) {
  const currentId = process.env.HERDR_WORKSPACE_ID;
  if (herdrMode() !== 'off' && currentId) {
    try {
      const baseId = openWorkspaces.get(path.resolve(mainWorktreePath));
      const targetId =
        baseId && baseId !== currentId
          ? baseId
          : (await listHerdrWorkspaces()).find((id) => id !== currentId);
      if (targetId) {
        await focusHerdrWorkspace(targetId);
        await closeHerdrWorkspace(currentId);
        return;
      }
    } catch (err) {
      logWarn(`${userMessage(err)} — opening a shell in the base worktree instead.`);
    }
  }
  spawnShellIn(mainWorktreePath);
}

/**
 * Interactive half of removal. Asks everything up front so nothing destructive
 * happens before the last answer:
 *   - once: whether to close the open herdr workspaces (never geet's own)
 *   - per worktree with blocking changes: list them, then reset or skip
 *
 * `openWorkspaces` maps worktree path → herdr workspace id. Returns plans for the
 * worktrees that should be removed (skipped ones are omitted); `workspaceId` is
 * set only when that workspace should be closed.
 */
async function planWorktreeRemovals(
  worktrees: Worktree[],
  openWorkspaces: Map<string, string>,
): Promise<RemovalPlan[]> {
  const closableId = (w: Worktree): string | null => {
    const id = openWorkspaces.get(path.resolve(w.path));
    return id && id !== process.env.HERDR_WORKSPACE_ID ? id : null;
  };

  const closableCount = worktrees.filter((w) => closableId(w)).length;
  let closeWorkspaces = false;
  if (closableCount === 1) {
    closeWorkspaces = await promptConfirm(
      'A herdr workspace is open for this worktree. Close it too?',
    );
  } else if (closableCount > 1) {
    closeWorkspaces = await promptConfirm(
      `${closableCount} of these worktrees have an open herdr workspace. Close them too?`,
    );
  }

  const plans: RemovalPlan[] = [];
  for (const worktree of worktrees) {
    const changes = await getWorktreeChanges(worktree.path);
    const reset = changes.length > 0;
    if (reset) {
      logWarn(`Uncommitted changes in ${worktree.path}:\n${changes.join('\n')}`);
      if ((await promptWorktreeChangesForRemove(worktree.branch)) === 'skip') continue;
    }
    plans.push({ worktree, workspaceId: closeWorkspaces ? closableId(worktree) : null, reset });
  }
  return plans;
}

/**
 * Executing half of removal: reset (if planned), remove, then close the herdr
 * workspace (if planned; failure there is only a warning). Throws if git
 * refuses to reset or remove.
 */
async function executeWorktreeRemoval({ worktree, workspaceId, reset }: RemovalPlan) {
  if (reset) {
    const sReset = spinner();
    sReset.start(`Resetting "${worktree.branch}"...`);
    await resetWorktree(worktree.path);
    sReset.stop('Worktree reset.');
  }

  const s = spinner();
  s.start(`Removing worktree "${worktree.branch}"...`);
  try {
    await removeWorktree(worktree.path);
  } catch (err) {
    s.stop(`Failed to remove: ${worktree.branch}`);
    throw err;
  }
  s.stop(`Removed: ${worktree.branch}`);

  if (workspaceId) {
    try {
      await closeHerdrWorkspace(workspaceId);
    } catch (err) {
      logWarn(`Could not close herdr workspace: ${userMessage(err)}`);
    }
  }
}

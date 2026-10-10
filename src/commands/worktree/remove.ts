/**
 * commands/worktree/remove.ts
 * Implements:
 *   geet worktree remove   — interactive; multi-select worktrees to delete
 *   geet worktree prune    — fetch, then remove worktrees whose remote branches are gone
 */

import path from 'path';
import { userMessage } from '../../utils/errors.ts';
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
  promptWorktreeChangesForRemove,
  promptMultiSelectWorktrees,
  promptConfirm,
} from '../../prompts.ts';
import { closeHerdrWorkspace } from './utils/herdr.ts';
import { loadWorktrees } from './utils/loadWorktrees.ts';
import { openHerdrWorkspaces } from './utils/openWorktree.ts';

// ── worktree remove ───────────────────────────────────────────────────────────

export async function worktreeRemoveAction() {
  intro('geet wt remove');

  const loaded = await loadWorktrees({
    filter: (w) => !w.isMain,
    emptyMessage: 'No worktrees to remove.',
  });
  if (!loaded) return;

  await removeWorktrees('remove', loaded.candidates, loaded.all.find((w) => w.isMain)?.path);
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
) {
  const { prompt, done, preselected } = REMOVAL_COMMANDS[command];
  const selected = await promptMultiSelectWorktrees(prompt, candidates, { preselected });

  // Look up herdr workspaces before removal, while herdr still lists the checkout
  const openWorkspaces = await openHerdrWorkspaces(mainWorktreePath);

  const plans = await planWorktreeRemovals(selected, openWorkspaces);
  if (plans.length === 0) {
    outro('Nothing removed.');
    return;
  }

  const failed: { worktree: Worktree; message: string }[] = [];
  for (const plan of plans) {
    try {
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
    return;
  }

  outro(`${done} ${doneCount} worktree(s).`);
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

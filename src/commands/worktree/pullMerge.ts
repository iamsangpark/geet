/**
 * commands/worktree/pullMerge.ts
 * Implements:
 *   geet worktree pull    — pull the latest changes for a worktree's branch
 *   geet worktree merge   — merge a worktree's branch into the current branch
 */

import {
  getCurrentBranch,
  getUncommittedChanges,
  pullBranch,
  mergeBranch,
} from '../../utils/git.ts';
import { stashCurrentChanges } from '../../utils/stashChanges.ts';
import { intro, outro, logWarn, spinner } from '../../prompts/common.ts';
import { promptSelectWorktree, promptUncommittedChangesForMerge } from '../../prompts/worktree.ts';
import { loadWorktrees } from './utils/loadWorktrees.ts';

// ── worktree pull ─────────────────────────────────────────────────────────────

async function pullWithSpinner(branch: string) {
  const s = spinner();
  s.start(`Pulling latest for "${branch}"...`);
  await pullBranch(branch);
  s.stop(`"${branch}" is up to date.`);
}

export async function worktreePullAction() {
  intro('geet wt pull');

  const loaded = await loadWorktrees({ emptyMessage: 'No worktrees found.' });
  if (!loaded) return;

  const selected = await promptSelectWorktree(loaded.candidates, {
    message: 'Select a worktree to pull:',
  });
  await pullWithSpinner(selected.branch);

  outro('Done.');
}

// ── worktree merge ────────────────────────────────────────────────────────────

async function guardBeforeMerge(): Promise<void> {
  const changes = await getUncommittedChanges();
  if (changes) {
    logWarn(`Uncommitted changes detected:\n${changes}`);
    const action = await promptUncommittedChangesForMerge();
    if (action === 'add-and-stash') {
      await stashCurrentChanges({ includeUntracked: true });
    } else if (action === 'stash-first') {
      await stashCurrentChanges({ includeUntracked: false });
    }
    // 'merge-anyway' — fall through and merge
  }
}

export async function worktreeMergeAction(options: { pull?: boolean }) {
  intro('geet wt merge');

  const currentBranch = await getCurrentBranch();
  const loaded = await loadWorktrees({
    filter: (w) => w.branch !== currentBranch,
    emptyMessage: 'No other worktrees to merge.',
  });
  if (!loaded) return;

  const selected = await promptSelectWorktree(loaded.candidates, {
    message: 'Select a worktree to merge into the current branch:',
  });

  await guardBeforeMerge();

  if (options.pull) await pullWithSpinner(selected.branch);

  const s = spinner();
  s.start(`Merging "${selected.branch}" into "${currentBranch}"...`);
  await mergeBranch(selected.branch);
  s.stop(`Merged "${selected.branch}" into "${currentBranch}".`);

  outro('Done.');
}

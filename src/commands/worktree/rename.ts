/**
 * commands/worktree/rename.ts
 * Implements `geet worktree rename` — move a worktree's folder and rename its branch.
 */

import path from 'path';
import { moveWorktree, checkoutNewBranchInDir, deleteBranch } from '../../utils/git.ts';
import {
  intro,
  outro,
  logInfo,
  spinner,
  promptSelectWorktreeForRename,
  promptWorktreeSmartAdd,
  promptConfirm,
} from '../../prompts.ts';
import { buildWorktreeNames, parseWorktreePath } from './utils/naming.ts';
import { loadWorktrees } from './utils/loadWorktrees.ts';

export async function worktreeRenameAction() {
  intro('geet wt rename');

  const loaded = await loadWorktrees({
    filter: (w) => !w.isMain,
    emptyMessage: 'No worktrees to rename.',
  });
  if (!loaded) return;

  const selected = await promptSelectWorktreeForRename(loaded.candidates);

  // Pre-fill the prompts from the current path
  const names = buildWorktreeNames(
    await promptWorktreeSmartAdd(undefined, parseWorktreePath(selected.path)),
  );
  const newDir = path.resolve(names.dir);
  const newBranch = names.branch;
  const oldDir = selected.path;
  const oldBranch = selected.branch;

  logInfo(`New worktree path: ${newDir}`);
  logInfo(`New branch:        ${newBranch}`);

  if (newDir !== oldDir) {
    const s2 = spinner();
    s2.start(`Moving worktree to "${newDir}"...`);
    await moveWorktree(oldDir, newDir);
    s2.stop('Worktree moved.');
  }

  if (newBranch !== oldBranch) {
    const s3 = spinner();
    s3.start(`Creating branch "${newBranch}" and switching worktree...`);
    await checkoutNewBranchInDir(newBranch, newDir);
    s3.stop('Branch renamed.');

    const shouldDelete = await promptConfirm(`Delete old branch "${oldBranch}"?`);
    if (shouldDelete) {
      const s4 = spinner();
      s4.start(`Deleting branch "${oldBranch}"...`);
      await deleteBranch(oldBranch);
      s4.stop('Old branch deleted.');
    }
  }

  outro(`Renamed: ${newDir}`);
}

/**
 * commands/worktree/linkFix.ts
 * Implements `geet worktree link-fix` — re-link GEET_SYMLINK_PATHS into a worktree.
 */

import { GeetError } from '../../utils/errors.ts';
import { SYMLINK_PATHS } from '../../config.ts';
import { intro, outro, logInfo, promptSelectWorktreeForLinkFix } from '../../prompts.ts';
import { linkPaths } from './utils/symlinks.ts';
import { loadWorktrees } from './utils/loadWorktrees.ts';

export async function worktreeLinkFixAction() {
  intro('geet wt link-fix');

  if (SYMLINK_PATHS.length === 0) {
    logInfo('No symlink paths configured (GEET_SYMLINK_PATHS is empty).');
    outro('Done.');
    return;
  }

  const loaded = await loadWorktrees({
    filter: (w) => !w.isMain,
    emptyMessage: 'No other worktrees found.',
  });
  if (!loaded) return;

  const mainWorktree = loaded.all.find((w) => w.isMain);
  if (!mainWorktree) {
    throw new GeetError('Could not determine the main worktree.');
  }

  const selected = await promptSelectWorktreeForLinkFix(loaded.candidates);

  await linkPaths(mainWorktree.path, selected.path, SYMLINK_PATHS, { replace: true });

  outro(`Re-linked symlinks in: ${selected.path}`);
}

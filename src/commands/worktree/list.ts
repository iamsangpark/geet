/**
 * commands/worktree/list.ts
 * Implements `geet worktree list` — pick a worktree; copies its path + opens it.
 */

import path from 'path';
import { copyToClipboard } from '../../utils/clipboard.ts';
import { intro } from '../../prompts/common.ts';
import { promptSelectWorktree } from '../../prompts/worktree.ts';
import { loadWorktrees } from './utils/loadWorktrees.ts';
import { openWorktree, openHerdrWorkspaces } from './utils/openWorktree.ts';

export async function worktreeListAction() {
  intro('geet wt list');

  const loaded = await loadWorktrees({
    filter: (w) => !w.isMain,
    emptyMessage: 'No other worktrees found.',
  });
  if (!loaded) return;
  const { all: worktrees } = loaded;

  const mainPath = worktrees.find((w) => w.isMain)?.path;
  const openWorkspaces = await openHerdrWorkspaces(mainPath);
  const decorated = worktrees.map((w) =>
    openWorkspaces.has(path.resolve(w.path)) ? { ...w, decorators: ['herdr ●'] } : w,
  );

  const selected = await promptSelectWorktree(decorated);

  await copyToClipboard(selected.path, 'Path copied to clipboard');

  await openWorktree(selected.path, mainPath, {
    alreadyOpen: openWorkspaces.has(path.resolve(selected.path)),
  });
}

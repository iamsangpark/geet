import { listWorktrees, type Worktree } from '../../../utils/git.ts';
import { outro, logInfo, spinner } from '../../../prompts/common.ts';

/**
 * Lists worktrees behind a spinner and narrows them with `filter`. When nothing is
 * left, reports `emptyMessage`, closes the flow with `outro` and returns null so
 * the caller can simply `return`.
 *
 * `all` is the unfiltered list; `candidates` is the filtered one.
 */
export async function loadWorktrees({
  filter = () => true,
  emptyMessage,
}: {
  filter?: (w: Worktree) => boolean;
  emptyMessage: string;
}): Promise<{ all: Worktree[]; candidates: Worktree[] } | null> {
  const s = spinner();
  s.start('Listing worktrees...');
  const all = await listWorktrees();
  s.stop();

  const candidates = all.filter(filter);
  if (candidates.length === 0) {
    logInfo(emptyMessage);
    outro('Done.');
    return null;
  }
  return { all, candidates };
}

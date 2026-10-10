import { gitAddAll, stashSave } from './git.ts';
import { spinner } from '../prompts.ts';

/**
 * Stashes the working tree behind a spinner. With `includeUntracked`, everything
 * (including untracked files) is staged first so it ends up in the stash.
 */
export async function stashCurrentChanges({ includeUntracked }: { includeUntracked: boolean }) {
  const s = spinner();
  if (includeUntracked) {
    s.start('Staging all untracked files and stashing...');
    await gitAddAll();
    await stashSave();
    s.stop('All changes staged and stashed.');
  } else {
    s.start('Stashing current changes...');
    await stashSave();
    s.stop('Current changes stashed.');
  }
}

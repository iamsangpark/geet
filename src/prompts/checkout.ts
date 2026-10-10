/**
 * prompts/checkout.ts
 * Prompts for `geet checkout`.
 */

import * as p from '@clack/prompts';
import { guardCancel } from './common.ts';

/**
 * Shown when the user wants to checkout but has uncommitted changes.
 */
export async function promptUncommittedChanges(
  branch?: string,
): Promise<'add-and-stash' | 'stash' | 'force'> {
  const action = await p.select<'add-and-stash' | 'stash' | 'force'>({
    message: `You have uncommitted changes. What should happen before checking out ${branch ? `"${branch}"` : 'the branch'}?`,
    options: [
      { value: 'add-and-stash', label: 'Add all untracked files, then stash' },
      { value: 'stash', label: 'Stash tracked changes only, then checkout' },
      { value: 'force', label: 'Force checkout (discard uncommitted changes)' },
    ],
  });
  return guardCancel(action);
}

/**
 * Prompts the user to enter a branch name (used when none was provided as an arg).
 */
export async function promptBranchName(): Promise<string> {
  const name = await p.text({
    message: 'Branch name:',
    validate: (v) => (!v?.trim() ? 'Branch name cannot be empty.' : undefined),
  });
  return guardCancel(name);
}

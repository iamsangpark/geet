/**
 * prompts/stash.ts
 * Prompts for `geet stash`.
 */

import * as p from '@clack/prompts';
import type { Stash } from '../utils/git.ts';
import { guardCancel } from './common.ts';

/**
 * Shown before `stash pop` when there are uncommitted changes.
 */
export async function promptUncommittedChangesForPop(): Promise<
  'add-and-stash' | 'stash-first' | 'pop-anyway'
> {
  const action = await p.select<'add-and-stash' | 'stash-first' | 'pop-anyway'>({
    message: 'You have uncommitted changes. How should we proceed?',
    options: [
      { value: 'add-and-stash', label: 'Add all untracked files, then stash' },
      { value: 'stash-first', label: 'Stash tracked changes only, then pop' },
      { value: 'pop-anyway', label: 'Pop anyway (may cause conflicts)' },
    ],
  });
  return guardCancel(action);
}

/**
 * Prompts the user for an optional stash message.
 * Empty string means no message (uses git default).
 */
export async function promptStashMessage(): Promise<string> {
  const message = await p.text({
    message: 'Stash message (optional, press Enter to skip):',
    placeholder: 'WIP: my changes',
  });
  return guardCancel(message);
}

/**
 * Displays all stashes and lets the user select one.
 */
export async function promptSelectStash(stashes: Stash[]): Promise<Stash> {
  const selected = await p.select<Stash>({
    message: 'Select a stash to pop:',
    options: stashes.map((s) => ({
      value: s,
      label: `[${s.index}] ${s.name}`,
      hint: s.date,
    })),
  });
  return guardCancel(selected);
}

/**
 * commands/track.ts
 * Implements `geet track` — set the current branch's upstream to origin/<branch>.
 */

import type { Command } from 'commander';
import { getCurrentBranch, setUpstreamToOrigin } from '../utils/git.ts';
import { GeetError } from '../utils/errors.ts';
import { intro, outro } from '../prompts/common.ts';

export async function trackAction() {
  intro('geet track');

  const branch = await getCurrentBranch();
  if (branch === 'HEAD') {
    throw new GeetError('Detached HEAD — check out a branch first.');
  }

  await setUpstreamToOrigin(branch);
  outro(`"${branch}" now tracks origin/${branch}.`);
}

export function registerTrackCommand(program: Command) {
  program
    .command('track')
    .description('Set the current branch to track origin/<same-name>')
    .action(trackAction);
}

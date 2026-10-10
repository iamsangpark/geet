/**
 * commands/checkout.ts
 * Implements `geet checkout [branch]` with uncommitted-change safety.
 */

import {
  getUncommittedChanges,
  branchExists,
  checkoutBranch,
  checkoutNewBranch,
  checkoutForce,
} from '../utils/git.ts';

import { stashCurrentChanges } from '../utils/stashChanges.ts';

import {
  intro,
  outro,
  logInfo,
  logWarn,
  spinner,
  promptUncommittedChanges,
  promptBranchName,
} from '../prompts.ts';

export async function checkoutAction(branch?: string) {
  intro('geet co');

  // If no branch arg, prompt for one
  if (!branch) {
    branch = await promptBranchName();
  }

  const changes = await getUncommittedChanges();
  let useForce = false;

  if (changes) {
    logWarn(`Uncommitted changes detected:\n${changes}`);
    const action = await promptUncommittedChanges(branch);

    if (action === 'add-and-stash') {
      await stashCurrentChanges({ includeUntracked: true });
    } else if (action === 'stash') {
      await stashCurrentChanges({ includeUntracked: false });
    } else {
      // 'force' — will use --force flag
      useForce = true;
    }
  }

  // Determine how to checkout
  const s = spinner();
  s.start(`Switching to "${branch}"...`);

  if (useForce) {
    await checkoutForce(branch);
  } else {
    const { local, remote } = await branchExists(branch);
    if (local || remote) {
      // Exists locally or as a remote-tracking branch — regular checkout
      await checkoutBranch(branch);
    } else {
      // Branch doesn't exist anywhere — create it
      s.stop(`Branch "${branch}" not found locally or remotely.`);
      logInfo(`Creating new branch "${branch}"...`);
      s.start(`Creating "${branch}"...`);
      await checkoutNewBranch(branch);
    }
  }

  s.stop(`Switched to "${branch}".`);
  outro(`Done.`);
}

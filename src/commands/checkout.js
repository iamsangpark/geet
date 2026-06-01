/**
 * commands/checkout.js
 * Implements `ga checkout [branch]` with uncommitted-change safety.
 */

import {
  getUncommittedChanges,
  branchExists,
  checkoutBranch,
  checkoutNewBranch,
  checkoutForce,
  stashSave,
  gitAddAll,
} from '../gitUtils.js';

import {
  intro,
  outro,
  logInfo,
  logWarn,
  spinner,
  promptUncommittedChanges,
  promptBranchName,
} from '../prompts.js';

export async function checkoutAction(branch, _options) {
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
      const s = spinner();
      s.start('Staging all untracked files and stashing...');
      await gitAddAll();
      await stashSave();
      s.stop('All changes staged and stashed.');
    } else if (action === 'stash') {
      const s = spinner();
      s.start('Stashing changes...');
      await stashSave();
      s.stop('Changes stashed.');
    } else {
      // 'force' — will use --force flag
      useForce = true;
    }
  }

  // Determine how to checkout
  const s = (await import('../prompts.js')).spinner();
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

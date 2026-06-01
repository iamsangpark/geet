/**
 * commands/mergeRelease.js
 * Implements `ga merge-release <source> <dest>`.
 *
 * Workflow:
 *   1. Fetch all remotes
 *   2. Update both branches via their remote-tracking refs
 *   3. Checkout dest and merge source into it
 *   4. If -n/--no-change: use `git merge -X ours --no-commit` for manual inspection
 *   5. Print git diff vs origin/<dest> so the user can review before pushing
 */

import {
  fetchAll,
  pullBranch,
  checkoutBranch,
  mergeBranch,
  getDiffVsOrigin,
} from '../gitUtils.js';

import { intro, outro, logInfo, logWarn, spinner } from '../prompts.js';

export async function mergeReleaseAction(source, dest, options) {
  intro(`geet merge-release: ${source} → ${dest}`);

  // Step 1: Fetch all remotes
  const s1 = spinner();
  s1.start('Fetching all remotes...');
  await fetchAll();
  s1.stop('Fetched.');

  // Step 2: Pull both branches (update via remote-tracking refs, no checkout switching)
  const s2 = spinner();
  s2.start(`Updating "${dest}"...`);
  await pullBranch(dest);
  s2.stop(`"${dest}" is up to date.`);

  const s3 = spinner();
  s3.start(`Updating "${source}"...`);
  await pullBranch(source);
  s3.stop(`"${source}" is up to date.`);

  // Step 3: Checkout dest
  const s4 = spinner();
  s4.start(`Switching to "${dest}"...`);
  await checkoutBranch(dest);
  s4.stop(`On "${dest}".`);

  // Step 4: Merge
  const s5 = spinner();
  // commander maps `--no-change` → options.change = false
  const noCommitOurs = options.change === false;

  if (noCommitOurs) {
    s5.start(`Merging "${source}" into "${dest}" (strategy: ours, --no-commit)...`);
    await mergeBranch(source, { noCommit: true, strategy: 'ours' });
    s5.stop('Merge staged but not committed. Inspect changes, then commit manually.');
    logWarn('The merge is paused. Review the staged changes and run `git commit` when ready.');
  } else {
    s5.start(`Merging "${source}" into "${dest}"...`);
    await mergeBranch(source);
    s5.stop(`Merged "${source}" into "${dest}".`);
  }

  // Step 5: Show diff vs origin
  logInfo(`\nDiff between local "${dest}" and origin/${dest}:`);

  const diff = await getDiffVsOrigin(dest);
  if (diff.trim()) {
    // Print raw diff directly — colour and formatting come from git itself
    process.stdout.write('\n' + diff + '\n');
  } else {
    logInfo('No diff — local branch matches origin.');
  }

  outro('Review the diff above before pushing.');
}

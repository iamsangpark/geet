/**
 * commands/worktree.js
 * Implements:
 *   geet worktree new                  — create a new branch + worktree interactively
 *   geet worktree add                  — check out an existing local branch as a worktree
 *   geet worktree list                 — pick a worktree; copies path + opens shell
 *   geet worktree remove               — interactive; delete a selected worktree
 */

import path from 'path';
import os from 'os';
import { createInterface } from 'readline';
import { symlink, mkdir, access, unlink } from 'fs/promises';
import { constants } from 'fs';
import { spawn } from 'child_process';
import { execa } from 'execa';
import { WORKTREE_BASE, BRANCH_PREFIX, SYMLINK_PATHS, readProjectMap } from '../config.js';
import {
  addWorktree,
  removeWorktree,
  moveWorktree,
  checkoutNewBranchInDir,
  deleteBranch,
  listWorktrees,
  listLocalBranches,
  fetchPrune,
  remoteTrackingExists,
  getCurrentBranch,
  getUncommittedChanges,
  gitAddAll,
  stashSave,
  pullBranch,
  mergeBranch,
} from '../gitUtils.js';
import {
  intro,
  outro,
  logInfo,
  logWarn,
  logError,
  logSuccess,
  spinner,
  promptSelectWorktree,
  promptSelectWorktreeForRemove,
  promptSelectWorktreeForRename,
  promptSelectWorktreeForLinkFix,
  promptSelectWorktreeForPull,
  promptSelectWorktreeForMerge,
  promptMultiSelectWorktreesForPrune,
  promptUncommittedChangesForMerge,
  promptWorktreeSmartAdd,
  promptWorktreeProjectName,
  promptSelectExistingBranch,
  promptConfirm,
} from '../prompts.js';

// ── worktree new / add ────────────────────────────────────────────────────────

async function worktreeCreateImpl(introText, options) {
  intro(introText);

  let dir = options.folder;
  let branch = options.branch;

  if (!dir || !branch) {
    let mappedProjectName;
    try {
      const worktrees = await listWorktrees();
      const main = worktrees.find((w) => w.isMain);
      if (main) {
        const projectMap = await readProjectMap();
        mappedProjectName = projectMap[path.basename(main.path)];
      }
    } catch {
      // project map is optional — silently skip on any error
    }

    if (mappedProjectName) {
      logInfo(`Using project mapping: ${mappedProjectName}`);
    }

    if (options.existing) {
      const s = spinner();
      s.start('Loading local branches...');
      const branches = await listLocalBranches();
      s.stop();

      if (branches.length === 0) {
        const err = new Error();
        err.gitMessage = 'No local branches available (all are already checked out in a worktree).';
        throw err;
      }

      branch = await promptSelectExistingBranch(branches);

      const { projectName } = await promptWorktreeProjectName(mappedProjectName);
      const folderName = branch.startsWith(BRANCH_PREFIX)
        ? branch.slice(BRANCH_PREFIX.length)
        : branch;
      dir = path.join(WORKTREE_BASE, projectName, folderName);
    } else {
      const { projectName, jiraName, description: rawDescription } = await promptWorktreeSmartAdd(mappedProjectName);
      const description = rawDescription.trim().replace(/ /g, '_');
      const folderName = jiraName ? `${jiraName}-${description}` : description;
      dir = path.join(WORKTREE_BASE, projectName, folderName);
      branch = `${BRANCH_PREFIX}${folderName}`;
    }

    logInfo(`Worktree path: ${dir}`);
    logInfo(`Branch:        ${branch}`);
  }

  const resolvedDir = path.resolve(dir);
  const s = spinner();
  s.start(`Adding worktree at "${resolvedDir}" for branch "${branch}"...`);
  await addWorktree(branch, resolvedDir);
  s.stop('Worktree created.');

  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(resolvedDir);
  logSuccess(`Path copied to clipboard: ${resolvedDir}`);

  await postWorktreeCreate(resolvedDir, { skipInit: !options.init });
}

export function worktreeNewAction(options) {
  return worktreeCreateImpl('geet wt new', options);
}

export function worktreeAddAction(options) {
  return worktreeCreateImpl('geet wt add', { ...options, existing: true });
}

// ── worktree list ─────────────────────────────────────────────────────────────

export async function worktreeListAction(_options) {
  intro('geet wt list');

  const s = spinner();
  s.start('Listing worktrees...');
  const worktrees = await listWorktrees();
  s.stop();

  if (worktrees.length <= 1) {
    logInfo('No other worktrees found.');
    outro('Done.');
    return;
  }

  const selected = await promptSelectWorktree(worktrees);

  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(selected.path);
  logSuccess(`Path copied to clipboard: ${selected.path}`);

  outro(`Spawning shell in: ${selected.path}`);
  spawnShellIn(selected.path);
}

// ── worktree copy-path ────────────────────────────────────────────────────────

export async function worktreeCopyPathAction(_options) {
  intro('geet wt copy-path');

  const worktrees = await listWorktrees();
  const cwd = process.cwd();
  const current = worktrees.find((w) => cwd === w.path || cwd.startsWith(w.path + path.sep));

  if (!current) {
    const err = new Error();
    err.gitMessage = 'Could not determine the current worktree path.';
    throw err;
  }

  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(current.path);
  logSuccess(`Copied to clipboard: ${current.path}`);

  outro('Done.');
}

// ── worktree remove ───────────────────────────────────────────────────────────

export async function worktreeRemoveAction(_options) {
  intro('geet wt remove');

  const s = spinner();
  s.start('Listing worktrees...');
  const all = await listWorktrees();
  s.stop();

  const removable = all.filter((w) => !w.isMain);

  if (removable.length === 0) {
    logInfo('No worktrees to remove.');
    outro('Done.');
    return;
  }

  const selected = await promptSelectWorktreeForRemove(removable);

  const s2 = spinner();
  s2.start(`Removing worktree "${selected.branch}"...`);
  await removeWorktree(selected.path);
  s2.stop('Worktree removed.');

  outro(`Removed: ${selected.path}`);
}

// ── worktree prune ────────────────────────────────────────────────────────────

export async function worktreePruneAction(_options) {
  intro('geet wt prune');

  const s = spinner();
  s.start('Fetching latest branch information from origin...');
  await fetchPrune();
  s.stop('Fetch complete.');

  const s2 = spinner();
  s2.start('Checking worktrees against remote...');
  const all = await listWorktrees();
  const removable = all.filter((w) => !w.isMain && w.branch !== '(detached HEAD)');

  const stale = [];
  for (const w of removable) {
    const exists = await remoteTrackingExists(w.branch);
    if (!exists) stale.push(w);
  }
  s2.stop();

  if (stale.length === 0) {
    logInfo('No stale worktrees found — all remote branches are still open.');
    outro('Done.');
    return;
  }

  const toRemove = await promptMultiSelectWorktreesForPrune(stale);

  if (toRemove.length === 0) {
    outro('Nothing removed.');
    return;
  }

  const s3 = spinner();
  const failed = [];
  for (const w of toRemove) {
    s3.start(`Removing worktree "${w.branch}"...`);
    try {
      await removeWorktree(w.path);
      s3.stop(`Removed: ${w.branch}`);
    } catch (err) {
      s3.stop(`Failed to remove: ${w.branch}`);
      failed.push({ worktree: w, message: err.gitMessage || err.message });
    }
  }

  const removedCount = toRemove.length - failed.length;
  if (removedCount > 0) {
    logInfo(`Pruned ${removedCount} worktree(s).`);
  }

  if (failed.length > 0) {
    logError(`Failed to remove ${failed.length} worktree(s):`);
    for (const { worktree, message } of failed) {
      logError(`  ${worktree.branch} (${worktree.path}): ${message}`);
    }
    outro('Prune completed with errors.');
    return;
  }

  outro(`Pruned ${toRemove.length} worktree(s).`);
}

// ── worktree rename ───────────────────────────────────────────────────────────

export async function worktreeRenameAction(_options) {
  intro('geet wt rename');

  const s = spinner();
  s.start('Listing worktrees...');
  const all = await listWorktrees();
  s.stop();

  const renameable = all.filter((w) => !w.isMain);

  if (renameable.length === 0) {
    logInfo('No worktrees to rename.');
    outro('Done.');
    return;
  }

  const selected = await promptSelectWorktreeForRename(renameable);

  // Parse current path into projectName / jiraName / description for pre-filling
  const currentFolderName = path.basename(selected.path);
  const currentProjectName = path.basename(path.dirname(selected.path));
  const jiraMatch = currentFolderName.match(/^([A-Z]+-\d+)-(.+)$/);
  const currentJiraName = jiraMatch ? jiraMatch[1] : '';
  const currentDescription = (jiraMatch ? jiraMatch[2] : currentFolderName).replace(/_/g, ' ');

  const { projectName, jiraName, description: rawDescription } = await promptWorktreeSmartAdd(null, {
    projectName: currentProjectName,
    jiraName: currentJiraName,
    description: currentDescription,
  });

  const description = rawDescription.trim().replace(/ /g, '_');
  const newFolderName = jiraName ? `${jiraName}-${description}` : description;
  const newDir = path.resolve(path.join(WORKTREE_BASE, projectName, newFolderName));
  const newBranch = `${BRANCH_PREFIX}${newFolderName}`;
  const oldDir = selected.path;
  const oldBranch = selected.branch;

  logInfo(`New worktree path: ${newDir}`);
  logInfo(`New branch:        ${newBranch}`);

  if (newDir !== oldDir) {
    const s2 = spinner();
    s2.start(`Moving worktree to "${newDir}"...`);
    await moveWorktree(oldDir, newDir);
    s2.stop('Worktree moved.');
  }

  if (newBranch !== oldBranch) {
    const s3 = spinner();
    s3.start(`Creating branch "${newBranch}" and switching worktree...`);
    await checkoutNewBranchInDir(newBranch, newDir);
    s3.stop('Branch renamed.');

    const shouldDelete = await promptConfirm(`Delete old branch "${oldBranch}"?`);
    if (shouldDelete) {
      const s4 = spinner();
      s4.start(`Deleting branch "${oldBranch}"...`);
      await deleteBranch(oldBranch);
      s4.stop('Old branch deleted.');
    }
  }

  outro(`Renamed: ${newDir}`);
}

// ── worktree link-fix ─────────────────────────────────────────────────────────

export async function worktreeLinkFixAction(_options) {
  intro('geet wt link-fix');

  if (SYMLINK_PATHS.length === 0) {
    logInfo('No symlink paths configured (GEET_SYMLINK_PATHS is empty).');
    outro('Done.');
    return;
  }

  const s = spinner();
  s.start('Listing worktrees...');
  const all = await listWorktrees();
  s.stop();

  const mainWorktree = all.find((w) => w.isMain);
  if (!mainWorktree) {
    const err = new Error();
    err.gitMessage = 'Could not determine the main worktree.';
    throw err;
  }

  const nonMain = all.filter((w) => !w.isMain);
  if (nonMain.length === 0) {
    logInfo('No other worktrees found.');
    outro('Done.');
    return;
  }

  const selected = await promptSelectWorktreeForLinkFix(nonMain);

  await relinkSymlinks(mainWorktree.path, selected.path, SYMLINK_PATHS);

  outro(`Re-linked symlinks in: ${selected.path}`);
}

// ── worktree pull ─────────────────────────────────────────────────────────────

export async function worktreePullAction(_options) {
  intro('geet wt pull');

  const s = spinner();
  s.start('Listing worktrees...');
  const all = await listWorktrees();
  s.stop();

  if (all.length === 0) {
    logInfo('No worktrees found.');
    outro('Done.');
    return;
  }

  const selected = await promptSelectWorktreeForPull(all);

  const s2 = spinner();
  s2.start(`Pulling latest for "${selected.branch}"...`);
  await pullBranch(selected.branch);
  s2.stop(`"${selected.branch}" is up to date.`);

  outro('Done.');
}

// ── worktree merge ────────────────────────────────────────────────────────────

async function guardBeforeMerge() {
  const changes = await getUncommittedChanges();
  if (changes) {
    logWarn(`Uncommitted changes detected:\n${changes}`);
    const action = await promptUncommittedChangesForMerge();
    if (action === 'add-and-stash') {
      const s = spinner();
      s.start('Staging all untracked files and stashing...');
      await gitAddAll();
      await stashSave();
      s.stop('All changes staged and stashed.');
    } else if (action === 'stash-first') {
      const s = spinner();
      s.start('Stashing current changes...');
      await stashSave();
      s.stop('Current changes stashed.');
    }
    // 'merge-anyway' — fall through and merge
  }
}

export async function worktreeMergeAction(options) {
  intro('geet wt merge');

  const s = spinner();
  s.start('Listing worktrees...');
  const currentBranch = await getCurrentBranch();
  const all = await listWorktrees();
  s.stop();

  const mergeable = all.filter((w) => w.branch !== currentBranch);

  if (mergeable.length === 0) {
    logInfo('No other worktrees to merge.');
    outro('Done.');
    return;
  }

  const selected = await promptSelectWorktreeForMerge(mergeable);

  await guardBeforeMerge();

  if (options.pull) {
    const sPull = spinner();
    sPull.start(`Pulling latest for "${selected.branch}"...`);
    await pullBranch(selected.branch);
    sPull.stop(`"${selected.branch}" is up to date.`);
  }

  const s2 = spinner();
  s2.start(`Merging "${selected.branch}" into "${currentBranch}"...`);
  await mergeBranch(selected.branch);
  s2.stop(`Merged "${selected.branch}" into "${currentBranch}".`);

  outro('Done.');
}

// ── Post-create helper ────────────────────────────────────────────────────────

/**
 * After a worktree is created:
 *   1. Create configured symlinks from the main worktree
 *   2. Run ~/.geet/init/default.sh (if executable), then ~/.geet/init/<repo-name>.sh (if executable)
 *   3. Spawn an interactive shell in the new directory
 */
async function postWorktreeCreate(dir, { skipInit = false } = {}) {
  const worktrees = await listWorktrees();
  const mainWorktree = worktrees.find((w) => w.isMain);

  if (mainWorktree && SYMLINK_PATHS.length > 0) {
    await createSymlinks(mainWorktree.path, dir, SYMLINK_PATHS);
  }

  if (mainWorktree && !skipInit) {
    await runInitScript(mainWorktree.path, dir);
  }

  outro(`Spawning shell in: ${dir}`);
  spawnShellIn(dir);
}

/**
 * Runs a single init script if it exists and is executable.
 * Streams output into a rolling 4-line window using ANSI cursor control.
 */
async function runScript(scriptPath, newWorktreeDir) {
  try {
    await access(scriptPath, constants.X_OK);
  } catch {
    return; // script doesn't exist or isn't executable — skip silently
  }

  logInfo(`Running init script: ${scriptPath}`);

  const TAIL = 4;
  const lines = [];
  let windowDrawn = false;

  const drawWindow = () => {
    const cols = process.stdout.columns || 80;
    const maxWidth = cols - 6;
    const tail = lines.slice(-TAIL);

    if (windowDrawn) {
      process.stdout.write(`\x1b[${TAIL}A\x1b[0J`);
    }

    for (let i = 0; i < TAIL; i++) {
      const raw = tail[i] ?? '';
      const display = raw.length > maxWidth ? `${raw.slice(0, maxWidth - 3)}...` : raw;
      process.stdout.write(`  \x1b[2m│\x1b[0m ${display}\n`);
    }

    windowDrawn = true;
  };

  drawWindow();

  try {
    const proc = execa(scriptPath, [], { cwd: newWorktreeDir, all: true });
    const rl = createInterface({ input: proc.all, crlfDelay: Infinity });

    rl.on('line', (line) => {
      lines.push(line);
      drawWindow();
    });

    await Promise.all([proc, new Promise((resolve) => rl.once('close', resolve))]);

    logSuccess('Init script completed.');
  } catch (err) {
    logError(`Init script failed: ${err.message}`);
  }
}

/**
 * Runs ~/.geet/init/default.sh (if present) then ~/.geet/init/<repo-name>.sh
 * (if present) in the newly created worktree directory.
 *
 * @param {string} mainWorktreePath  — path to the main worktree (repo root)
 * @param {string} newWorktreeDir    — path to the newly created worktree
 */
async function runInitScript(mainWorktreePath, newWorktreeDir) {
  const initDir = path.join(os.homedir(), '.geet', 'init');
  await runScript(path.join(initDir, 'default.sh'), newWorktreeDir);

  const repoName = path.basename(mainWorktreePath);
  await runScript(path.join(initDir, `${repoName}.sh`), newWorktreeDir);
}

/**
 * Removes existing entries and creates fresh symlinks for each relative path
 * from sourceRoot into targetRoot.
 */
async function relinkSymlinks(sourceRoot, targetRoot, relativePaths) {
  for (const relPath of relativePaths) {
    const src = path.join(sourceRoot, relPath);
    const dest = path.join(targetRoot, relPath);

    try {
      await access(src, constants.F_OK);
    } catch {
      logWarn(`Skipped (source does not exist): ${relPath}`);
      continue;
    }

    await mkdir(path.dirname(dest), { recursive: true });

    try {
      await unlink(dest);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logError(`Failed to remove existing ${relPath}: ${err.message}`);
        continue;
      }
    }

    try {
      await symlink(src, dest);
      logSuccess(`Symlinked: ${relPath}`);
    } catch (err) {
      logError(`Failed to symlink ${relPath}: ${err.message}`);
    }
  }
}

/**
 * Creates soft symlinks for each relative path from sourceRoot into targetRoot.
 * Skips paths that already exist at the destination.
 */
async function createSymlinks(sourceRoot, targetRoot, relativePaths) {
  for (const relPath of relativePaths) {
    const src = path.join(sourceRoot, relPath);
    const dest = path.join(targetRoot, relPath);

    try {
      await access(src, constants.F_OK);
    } catch {
      logWarn(`Skipped (source does not exist): ${relPath}`);
      continue;
    }

    await mkdir(path.dirname(dest), { recursive: true });

    try {
      await symlink(src, dest);
      logSuccess(`Symlinked: ${relPath}`);
    } catch (err) {
      if (err.code === 'EEXIST') {
        logWarn(`Skipped (already exists): ${relPath}`);
      } else {
        logError(`Failed to symlink ${relPath}: ${err.message}`);
      }
    }
  }
}

/**
 * Spawns an interactive shell session in the given directory.
 */
function spawnShellIn(dir) {
  const shell = process.env.SHELL || '/bin/zsh';
  const child = spawn(shell, [], {
    cwd: dir,
    stdio: 'inherit',
    detached: false,
  });

  child.on('error', (err) => {
    logError(`Failed to spawn shell: ${err.message}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

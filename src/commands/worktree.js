/**
 * commands/worktree.js
 * Implements:
 *   geet worktree add <branch> <dir>   — direct worktree add
 *   geet worktree add -i               — interactive, formats path automatically
 *   geet worktree list                 — pick a worktree; copies path + opens shell
 *   geet worktree remove               — interactive; delete a selected worktree
 */

import path from 'path';
import os from 'os';
import { symlink, mkdir, access } from 'fs/promises';
import { constants } from 'fs';
import { spawn } from 'child_process';
import { execa } from 'execa';
import { WORKTREE_BASE, BRANCH_PREFIX, SYMLINK_PATHS, readProjectMap } from '../config.js';
import { addWorktree, removeWorktree, listWorktrees, listLocalBranches, fetchPrune, remoteTrackingExists } from '../gitUtils.js';
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
  promptMultiSelectWorktreesForPrune,
  promptWorktreeSmartAdd,
  promptWorktreeProjectName,
  promptSelectExistingBranch,
} from '../prompts.js';

// ── worktree add [branch] [dir] ───────────────────────────────────────────────

export async function worktreeAddAction(options) {
  intro('geet wt add');

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
      const { projectName, jiraName, description } = await promptWorktreeSmartAdd(mappedProjectName);
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

  await postWorktreeCreate(resolvedDir);
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
  for (const w of toRemove) {
    s3.start(`Removing worktree "${w.branch}"...`);
    await removeWorktree(w.path);
    s3.stop(`Removed: ${w.branch}`);
  }

  outro(`Pruned ${toRemove.length} worktree(s).`);
}

// ── Post-create helper ────────────────────────────────────────────────────────

/**
 * After a worktree is created:
 *   1. Create configured symlinks from the main worktree
 *   2. Run ~/.geet/init/default.sh (if executable), then ~/.geet/init/<repo-name>.sh (if executable)
 *   3. Copy the new path to the clipboard
 *   4. Spawn an interactive shell in the new directory
 */
async function postWorktreeCreate(dir) {
  const worktrees = await listWorktrees();
  const mainWorktree = worktrees.find((w) => w.isMain);

  if (mainWorktree && SYMLINK_PATHS.length > 0) {
    await createSymlinks(mainWorktree.path, dir, SYMLINK_PATHS);
  }

  if (mainWorktree) {
    await runInitScript(mainWorktree.path, dir);
  }

  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(dir);
  logSuccess(`Path copied to clipboard: ${dir}`);

  outro(`Spawning shell in: ${dir}`);
  spawnShellIn(dir);
}

/**
 * Runs a single init script if it exists and is executable.
 */
async function runScript(scriptPath, newWorktreeDir) {
  try {
    await access(scriptPath, constants.X_OK);
  } catch {
    return; // script doesn't exist or isn't executable — skip silently
  }

  logInfo(`Running init script: ${scriptPath}`);
  try {
    await execa(scriptPath, [], { cwd: newWorktreeDir, stdio: 'inherit' });
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

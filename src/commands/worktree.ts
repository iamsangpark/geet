/**
 * commands/worktree.ts
 * Implements:
 *   geet worktree new                  — create a new branch + worktree interactively
 *   geet worktree add                  — check out an existing local branch as a worktree
 *   geet worktree list                 — pick a worktree; copies path + opens shell
 *   geet worktree remove               — interactive; multi-select worktrees to delete
 */

import path from 'path';
import os from 'os';
import { createInterface } from 'readline';
import { symlink, mkdir, access, unlink } from 'fs/promises';
import { constants } from 'fs';
import { spawn } from 'child_process';
import { execa } from 'execa';
import { GeetError, errorCode, errorMessage, userMessage } from '../errors.ts';
import { WORKTREE_BASE, BRANCH_PREFIX, SYMLINK_PATHS, readProjectMap } from '../config.ts';
import {
  type Worktree,
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
  getWorktreeChanges,
  resetWorktree,
  gitAddAll,
  stashSave,
  pullBranch,
  mergeBranch,
} from '../gitUtils.ts';
import {
  herdrMode,
  listHerdrWorktrees,
  openHerdrWorktree,
  closeHerdrWorkspace,
} from '../herdrUtils.ts';
import {
  intro,
  outro,
  logInfo,
  logWarn,
  logError,
  logSuccess,
  spinner,
  promptSelectWorktree,
  promptWorktreeChangesForRemove,
  promptSelectWorktreeForRename,
  promptSelectWorktreeForLinkFix,
  promptSelectWorktreeForPull,
  promptSelectWorktreeForMerge,
  promptMultiSelectWorktrees,
  promptUncommittedChangesForMerge,
  promptWorktreeSmartAdd,
  promptWorktreeProjectName,
  promptSelectExistingBranch,
  promptConfirm,
  promptHerdrOpen,
} from '../prompts.ts';

interface CreateOptions {
  folder?: string;
  branch?: string;
  existing?: boolean;
  init?: boolean;
}

// ── worktree new / add ────────────────────────────────────────────────────────

async function worktreeCreateImpl(introText: string, options: CreateOptions) {
  intro(introText);

  let dir = options.folder;
  let branch = options.branch;

  if (!dir || !branch) {
    let mappedProjectName: string | undefined;
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
        throw new GeetError(
          'No local branches available (all are already checked out in a worktree).',
        );
      }

      branch = await promptSelectExistingBranch(branches);

      const { projectName } = await promptWorktreeProjectName(mappedProjectName);
      const folderName = branch.startsWith(BRANCH_PREFIX)
        ? branch.slice(BRANCH_PREFIX.length)
        : branch;
      dir = path.join(WORKTREE_BASE, projectName, folderName);
    } else {
      const {
        projectName,
        jiraName,
        description: rawDescription,
      } = await promptWorktreeSmartAdd(mappedProjectName);
      const description = rawDescription.trim().replace(/ /g, '_');
      const folderName = jiraName ? `${jiraName}-${description}` : description;
      dir = path.join(WORKTREE_BASE, projectName, folderName);
      branch = `${BRANCH_PREFIX}${folderName}`;
    }
  }

  if (!dir || !branch) throw new GeetError('Worktree folder and branch are required.');

  const resolvedDir = path.resolve(dir);
  // Keep the spinner message short: clack redraws it in place, and a line wider
  // than the terminal wraps, leaving a repeated copy per animation frame.
  logInfo(`Worktree path: ${resolvedDir}`);
  logInfo(`Branch:        ${branch}`);
  const s = spinner();
  s.start('Adding worktree...');
  await addWorktree(branch, resolvedDir);
  s.stop('Worktree created.');

  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(resolvedDir);
  logSuccess(`Path copied to clipboard: ${resolvedDir}`);

  await postWorktreeCreate(resolvedDir, { skipInit: !options.init });
}

export function worktreeNewAction(options: CreateOptions) {
  return worktreeCreateImpl('geet wt new', options);
}

export function worktreeAddAction(options: CreateOptions) {
  return worktreeCreateImpl('geet wt add', { ...options, existing: true });
}

// ── worktree list ─────────────────────────────────────────────────────────────

export async function worktreeListAction(_options?: unknown) {
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

  const mainPath = worktrees.find((w) => w.isMain)?.path;
  const openWorkspaces = await openHerdrWorkspaces(mainPath);
  const decorated = worktrees.map((w) =>
    openWorkspaces.has(path.resolve(w.path)) ? { ...w, decorators: ['herdr ●'] } : w,
  );

  const selected = await promptSelectWorktree(decorated);

  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(selected.path);
  logSuccess(`Path copied to clipboard: ${selected.path}`);

  await openWorktree(selected.path, mainPath, {
    alreadyOpen: openWorkspaces.has(path.resolve(selected.path)),
  });
}

// ── worktree remove ───────────────────────────────────────────────────────────

export async function worktreeRemoveAction(_options?: unknown) {
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

  await removeWorktrees('remove', removable, all.find((w) => w.isMain)?.path);
}

// ── worktree prune ────────────────────────────────────────────────────────────

export async function worktreePruneAction(_options?: unknown) {
  intro('geet wt prune');

  const s = spinner();
  s.start('Fetching latest branch information from origin...');
  await fetchPrune();
  s.stop('Fetch complete.');

  const s2 = spinner();
  s2.start('Checking worktrees against remote...');
  const all = await listWorktrees();
  const removable = all.filter((w) => !w.isMain && w.branch !== '(detached HEAD)');

  const stale: Worktree[] = [];
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

  await removeWorktrees('prune', stale, all.find((w) => w.isMain)?.path);
}

// ── worktree rename ───────────────────────────────────────────────────────────

export async function worktreeRenameAction(_options?: unknown) {
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
  const currentJiraName = jiraMatch?.[1] ?? '';
  const currentDescription = (jiraMatch?.[2] ?? currentFolderName).replace(/_/g, ' ');

  const {
    projectName,
    jiraName,
    description: rawDescription,
  } = await promptWorktreeSmartAdd(undefined, {
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

export async function worktreeLinkFixAction(_options?: unknown) {
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
    throw new GeetError('Could not determine the main worktree.');
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

export async function worktreePullAction(_options?: unknown) {
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

async function guardBeforeMerge(): Promise<void> {
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

export async function worktreeMergeAction(options: { pull?: boolean }) {
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
async function postWorktreeCreate(dir: string, { skipInit = false } = {}) {
  const worktrees = await listWorktrees();
  const mainWorktree = worktrees.find((w) => w.isMain);

  if (mainWorktree && SYMLINK_PATHS.length > 0) {
    await createSymlinks(mainWorktree.path, dir, SYMLINK_PATHS);
  }

  if (mainWorktree && !skipInit) {
    await runInitScript(mainWorktree.path, dir);
  }

  await openWorktree(dir, mainWorktree?.path);
}

/**
 * Final step for new/list: open the worktree as a herdr workspace (or switch to
 * its existing one) when GEET_HERDR allows it and we're inside herdr; otherwise
 * — or if herdr fails — spawn a shell in the directory.
 *
 * `dir` is the worktree path; `mainWorktreePath` is the repo root, used as herdr's repo context.
 */
async function openWorktree(
  dir: string,
  mainWorktreePath?: string,
  { alreadyOpen = false }: { alreadyOpen?: boolean } = {},
) {
  const mode = herdrMode();

  if (mode !== 'off' && mainWorktreePath) {
    const choice = mode === 'prompt' ? await promptHerdrOpen(alreadyOpen) : 'herdr';

    if (choice === 'herdr') {
      try {
        const label = path.basename(dir);
        const result = await openHerdrWorktree({ repoPath: mainWorktreePath, dir, label });
        outro(`${result.alreadyOpen ? 'Switched to' : 'Opened'} herdr workspace: ${label}`);
        return;
      } catch (err) {
        logWarn(`${userMessage(err)} — falling back to a shell.`);
      }
    }
  }

  outro(`Spawning shell in: ${dir}`);
  spawnShellIn(dir);
}

/**
 * Best-effort lookup of herdr workspaces that are open for the given worktrees.
 * Returns a Map of worktree path → open workspace id. Empty when herdr is off
 * or unreachable.
 */
async function openHerdrWorkspaces(mainWorktreePath?: string): Promise<Map<string, string>> {
  const open = new Map<string, string>();
  if (herdrMode() === 'off' || !mainWorktreePath) return open;

  try {
    for (const w of await listHerdrWorktrees(mainWorktreePath)) {
      if (w.open_workspace_id) open.set(path.resolve(w.path), w.open_workspace_id);
    }
  } catch {
    // herdr unreachable — treat as "nothing open"
  }
  return open;
}

interface RemovalPlan {
  worktree: Worktree;
  workspaceId: string | null;
  reset: boolean;
}

const REMOVAL_COMMANDS = {
  remove: { prompt: 'Select worktrees to remove', done: 'Removed', preselected: false },
  prune: { prompt: 'Select worktrees to prune', done: 'Pruned', preselected: true },
};

/**
 * Everything `remove` and `prune` have in common once they know their candidate
 * worktrees: pick which to remove, gather every answer up front, remove them,
 * then report. Failures on individual worktrees don't stop the rest.
 */
async function removeWorktrees(
  command: keyof typeof REMOVAL_COMMANDS,
  candidates: Worktree[],
  mainWorktreePath?: string,
) {
  const { prompt, done, preselected } = REMOVAL_COMMANDS[command];
  const selected = await promptMultiSelectWorktrees(prompt, candidates, { preselected });

  // Look up herdr workspaces before removal, while herdr still lists the checkout
  const openWorkspaces = await openHerdrWorkspaces(mainWorktreePath);

  const plans = await planWorktreeRemovals(selected, openWorkspaces);
  if (plans.length === 0) {
    outro('Nothing removed.');
    return;
  }

  const failed: { worktree: Worktree; message: string }[] = [];
  for (const plan of plans) {
    try {
      await executeWorktreeRemoval(plan);
    } catch (err) {
      failed.push({ worktree: plan.worktree, message: userMessage(err) });
    }
  }

  const doneCount = plans.length - failed.length;
  if (failed.length > 0) {
    if (doneCount > 0) logInfo(`${done} ${doneCount} worktree(s).`);
    logError(`Failed to remove ${failed.length} worktree(s):`);
    for (const { worktree, message } of failed) {
      logError(`  ${worktree.branch} (${worktree.path}): ${message}`);
    }
    outro(`geet wt ${command} completed with errors.`);
    return;
  }

  outro(`${done} ${doneCount} worktree(s).`);
}

/**
 * Interactive half of removal. Asks everything up front so nothing destructive
 * happens before the last answer:
 *   - once: whether to close the open herdr workspaces (never geet's own)
 *   - per worktree with blocking changes: list them, then reset or skip
 *
 * `openWorkspaces` maps worktree path → herdr workspace id. Returns plans for the
 * worktrees that should be removed (skipped ones are omitted); `workspaceId` is
 * set only when that workspace should be closed.
 */
async function planWorktreeRemovals(
  worktrees: Worktree[],
  openWorkspaces: Map<string, string>,
): Promise<RemovalPlan[]> {
  const closableId = (w: Worktree): string | null => {
    const id = openWorkspaces.get(path.resolve(w.path));
    return id && id !== process.env.HERDR_WORKSPACE_ID ? id : null;
  };

  const closableCount = worktrees.filter((w) => closableId(w)).length;
  let closeWorkspaces = false;
  if (closableCount === 1) {
    closeWorkspaces = await promptConfirm(
      'A herdr workspace is open for this worktree. Close it too?',
    );
  } else if (closableCount > 1) {
    closeWorkspaces = await promptConfirm(
      `${closableCount} of these worktrees have an open herdr workspace. Close them too?`,
    );
  }

  const plans: RemovalPlan[] = [];
  for (const worktree of worktrees) {
    const changes = await getWorktreeChanges(worktree.path);
    const reset = changes.length > 0;
    if (reset) {
      logWarn(`Uncommitted changes in ${worktree.path}:\n${changes.join('\n')}`);
      if ((await promptWorktreeChangesForRemove(worktree.branch)) === 'skip') continue;
    }
    plans.push({ worktree, workspaceId: closeWorkspaces ? closableId(worktree) : null, reset });
  }
  return plans;
}

/**
 * Executing half of removal: reset (if planned), remove, then close the herdr
 * workspace (if planned; failure there is only a warning). Throws if git
 * refuses to reset or remove.
 */
async function executeWorktreeRemoval({ worktree, workspaceId, reset }: RemovalPlan) {
  if (reset) {
    const sReset = spinner();
    sReset.start(`Resetting "${worktree.branch}"...`);
    await resetWorktree(worktree.path);
    sReset.stop('Worktree reset.');
  }

  const s = spinner();
  s.start(`Removing worktree "${worktree.branch}"...`);
  try {
    await removeWorktree(worktree.path);
  } catch (err) {
    s.stop(`Failed to remove: ${worktree.branch}`);
    throw err;
  }
  s.stop(`Removed: ${worktree.branch}`);

  if (workspaceId) {
    try {
      await closeHerdrWorkspace(workspaceId);
    } catch (err) {
      logWarn(`Could not close herdr workspace: ${userMessage(err)}`);
    }
  }
}

/**
 * Runs a single init script if it exists and is executable.
 * Streams output into a rolling 4-line window using ANSI cursor control.
 */
async function runScript(scriptPath: string, newWorktreeDir: string) {
  try {
    await access(scriptPath, constants.X_OK);
  } catch {
    return; // script doesn't exist or isn't executable — skip silently
  }

  logInfo(`Running init script: ${scriptPath}`);

  const TAIL = 4;
  const lines: string[] = [];
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
    if (!proc.all) throw new Error('script output stream unavailable');
    const rl = createInterface({ input: proc.all, crlfDelay: Infinity });

    rl.on('line', (line) => {
      lines.push(line);
      drawWindow();
    });

    await Promise.all([proc, new Promise<void>((resolve) => rl.once('close', resolve))]);

    logSuccess('Init script completed.');
  } catch (err) {
    logError(`Init script failed: ${errorMessage(err)}`);
  }
}

/**
 * Runs ~/.geet/init/default.sh (if present) then ~/.geet/init/<repo-name>.sh
 * (if present) in the newly created worktree directory.
 */
async function runInitScript(mainWorktreePath: string, newWorktreeDir: string) {
  const initDir = path.join(os.homedir(), '.geet', 'init');
  await runScript(path.join(initDir, 'default.sh'), newWorktreeDir);

  const repoName = path.basename(mainWorktreePath);
  await runScript(path.join(initDir, `${repoName}.sh`), newWorktreeDir);
}

/**
 * Removes existing entries and creates fresh symlinks for each relative path
 * from sourceRoot into targetRoot.
 */
async function relinkSymlinks(sourceRoot: string, targetRoot: string, relativePaths: string[]) {
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
      if (errorCode(err) !== 'ENOENT') {
        logError(`Failed to remove existing ${relPath}: ${errorMessage(err)}`);
        continue;
      }
    }

    try {
      await symlink(src, dest);
      logSuccess(`Symlinked: ${relPath}`);
    } catch (err) {
      logError(`Failed to symlink ${relPath}: ${errorMessage(err)}`);
    }
  }
}

/**
 * Creates soft symlinks for each relative path from sourceRoot into targetRoot.
 * Skips paths that already exist at the destination.
 */
async function createSymlinks(sourceRoot: string, targetRoot: string, relativePaths: string[]) {
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
      if (errorCode(err) === 'EEXIST') {
        logWarn(`Skipped (already exists): ${relPath}`);
      } else {
        logError(`Failed to symlink ${relPath}: ${errorMessage(err)}`);
      }
    }
  }
}

/**
 * Spawns an interactive shell session in the given directory.
 */
function spawnShellIn(dir: string): void {
  const shell = process.env.SHELL || '/bin/zsh';
  const child = spawn(shell, [], {
    cwd: dir,
    stdio: 'inherit',
    detached: false,
  });

  child.on('error', (err) => {
    logError(`Failed to spawn shell: ${errorMessage(err)}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

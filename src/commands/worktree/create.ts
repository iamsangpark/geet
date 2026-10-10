/**
 * commands/worktree/create.ts
 * Implements:
 *   geet worktree new   — create a new branch + worktree interactively
 *   geet worktree add   — check out an existing local branch as a worktree
 */

import path from 'path';
import { GeetError } from '../../utils/errors.ts';
import { WORKTREE_BASE, BRANCH_PREFIX, SYMLINK_PATHS, readProjectMap } from '../../config.ts';
import { addWorktree, getMainWorktree, listLocalBranches } from '../../utils/git.ts';
import { copyToClipboard } from '../../utils/clipboard.ts';
import {
  intro,
  logInfo,
  spinner,
  promptWorktreeSmartAdd,
  promptWorktreeProjectName,
  promptSelectExistingBranch,
} from '../../prompts.ts';
import { buildWorktreeNames } from './utils/naming.ts';
import { linkPaths } from './utils/symlinks.ts';
import { runInitScript } from './utils/initScripts.ts';
import { openWorktree } from './utils/openWorktree.ts';

interface CreateOptions {
  folder?: string;
  branch?: string;
  existing?: boolean;
  init?: boolean;
}

async function worktreeCreateImpl(introText: string, options: CreateOptions) {
  intro(introText);

  let dir = options.folder;
  let branch = options.branch;

  if (!dir || !branch) {
    let mappedProjectName: string | undefined;
    try {
      const main = await getMainWorktree();
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
      const names = buildWorktreeNames(await promptWorktreeSmartAdd(mappedProjectName));
      dir = names.dir;
      branch = names.branch;
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

  await copyToClipboard(resolvedDir, 'Path copied to clipboard');

  await postWorktreeCreate(resolvedDir, { skipInit: !options.init });
}

export function worktreeNewAction(options: CreateOptions) {
  return worktreeCreateImpl('geet wt new', options);
}

export function worktreeAddAction(options: CreateOptions) {
  return worktreeCreateImpl('geet wt add', { ...options, existing: true });
}

/**
 * After a worktree is created:
 *   1. Create configured symlinks from the main worktree
 *   2. Run ~/.geet/init/default.sh (if executable), then ~/.geet/init/<repo-name>.sh (if executable)
 *   3. Open the worktree (herdr workspace or an interactive shell)
 */
async function postWorktreeCreate(dir: string, { skipInit = false } = {}) {
  const mainWorktree = await getMainWorktree();

  if (mainWorktree && SYMLINK_PATHS.length > 0) {
    await linkPaths(mainWorktree.path, dir, SYMLINK_PATHS);
  }

  if (mainWorktree && !skipInit) {
    await runInitScript(mainWorktree.path, dir);
  }

  await openWorktree(dir, mainWorktree?.path);
}

/**
 * prompts/worktree.ts
 * Prompts for `geet worktree`.
 */

import path from 'path';
import * as p from '@clack/prompts';
import type { Worktree } from '../utils/git.ts';
import { guardCancel, searchSelect, type SearchOption } from './common.ts';

/** A worktree, optionally annotated with extra hint strings. */
export type WorktreeOption = Worktree & { decorators?: string[] };

/**
 * Maps a worktree to a prompt option: folder name as the label, branch as the hint.
 * Optional `decorators` (extra strings) are appended to the hint.
 */
function toWorktreeOption(w: WorktreeOption): SearchOption<WorktreeOption> {
  return {
    value: w,
    label: path.basename(w.path),
    hint: [w.branch, ...(w.decorators ?? [])].join(' · '),
    searchText: `${w.branch} ${w.path}`,
  };
}

/**
 * Displays worktrees and lets the user select one. `message` words the prompt for the
 * command at hand (e.g. "Select a worktree to rename:").
 */
export async function promptSelectWorktree(
  worktrees: WorktreeOption[],
  { message = 'Select a worktree:' }: { message?: string } = {},
): Promise<WorktreeOption> {
  return searchSelect(message, worktrees.map(toWorktreeOption));
}

/**
 * Shown before `worktree remove` / `prune` when a worktree has changes that block removal.
 */
export async function promptWorktreeChangesForRemove(branch: string): Promise<'reset' | 'skip'> {
  const action = await p.select<'reset' | 'skip'>({
    message: `"${branch}" has changes that prevent removal. How should we proceed?`,
    options: [
      {
        value: 'reset',
        label: 'Reset and remove',
        hint: 'discards changes and deletes untracked files',
      },
      { value: 'skip', label: 'Skip', hint: 'keep this worktree' },
    ],
  });
  return guardCancel(action);
}

/**
 * Multiselect of worktrees. `preselected` controls whether everything starts checked.
 */
export async function promptMultiSelectWorktrees(
  message: string,
  worktrees: WorktreeOption[],
  { preselected = false }: { preselected?: boolean } = {},
): Promise<WorktreeOption[]> {
  const selected = await p.multiselect<WorktreeOption>({
    message: `${message} (space to toggle, enter to confirm):`,
    options: worktrees.map(toWorktreeOption),
    initialValues: preselected ? worktrees : [],
  });
  return guardCancel(selected);
}

/**
 * Shown before `worktree merge` when there are uncommitted changes.
 */
export async function promptUncommittedChangesForMerge(): Promise<
  'add-and-stash' | 'stash-first' | 'merge-anyway'
> {
  const action = await p.select<'add-and-stash' | 'stash-first' | 'merge-anyway'>({
    message: 'You have uncommitted changes. How should we proceed?',
    options: [
      { value: 'add-and-stash', label: 'Add all untracked files, then stash' },
      { value: 'stash-first', label: 'Stash tracked changes only, then merge' },
      { value: 'merge-anyway', label: 'Merge anyway (may cause conflicts)' },
    ],
  });
  return guardCancel(action);
}

/**
 * Prompts for the inputs to `worktree new` (project, Jira ticket, description).
 * Pass `mappedProjectName` to skip the project name prompt and use the mapping.
 */
export async function promptWorktreeProjectName(
  mappedProjectName?: string,
): Promise<{ projectName: string }> {
  let projectName = mappedProjectName;
  if (!projectName) {
    projectName = guardCancel(
      await p.text({
        message: 'Project name:',
        placeholder: 'my-project',
        validate: (v) => (!v?.trim() ? 'Project name cannot be empty.' : undefined),
      }),
    );
  }
  return { projectName };
}

export async function promptWorktreeSmartAdd(
  mappedProjectName?: string,
  initialValues: { projectName?: string; jiraName?: string; description?: string } = {},
): Promise<{ projectName: string; jiraName: string; description: string }> {
  let projectName = mappedProjectName;

  if (!projectName) {
    projectName = guardCancel(
      await p.text({
        message: 'Project name:',
        placeholder: 'my-project',
        initialValue: initialValues.projectName,
        validate: (v) => (!v?.trim() ? 'Project name cannot be empty.' : undefined),
      }),
    );
  }

  const jiraName = guardCancel(
    await p.text({
      message: 'Jira ticket (optional):',
      placeholder: 'PROJ-1234',
      initialValue: initialValues.jiraName,
    }),
  );

  const description = guardCancel(
    await p.text({
      message: 'Short description:',
      placeholder: 'add-login-page',
      initialValue: initialValues.description,
      validate: (v) => (!v?.trim() ? 'Description cannot be empty.' : undefined),
    }),
  );

  return { projectName, jiraName: jiraName?.trim() ?? '', description: description };
}

/**
 * Presents a select list of existing local branches not already in a worktree.
 * Resolves to the selected branch name.
 */
export async function promptSelectExistingBranch(branches: string[]): Promise<string> {
  return searchSelect(
    'Select existing branch:',
    branches.map((b) => ({ value: b, label: b, searchText: b })),
  );
}

/**
 * Ask whether to open a worktree as a herdr workspace or a plain shell.
 * `alreadyOpen`: a herdr workspace already exists for the worktree.
 */
export async function promptHerdrOpen(alreadyOpen: boolean): Promise<'herdr' | 'shell'> {
  const action = await p.select<'herdr' | 'shell'>({
    message: 'Open worktree:',
    options: [
      alreadyOpen
        ? { value: 'herdr', label: 'Switch to herdr workspace', hint: 'already open' }
        : { value: 'herdr', label: 'Open in new herdr workspace' },
      { value: 'shell', label: 'Open shell here' },
    ],
  });
  return guardCancel(action);
}

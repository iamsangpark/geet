/**
 * prompts.ts
 * Reusable @clack/prompts helpers.
 *
 * Key convention: every prompt result must be passed through guardCancel().
 * If the user presses ESC or Ctrl+C, @clack/prompts resolves the promise to
 * a special Symbol. isCancel() detects it, and guardCancel() calls p.cancel()
 * then process.exit(0) — a clean exit with no error.
 */

import path from 'path';
import * as p from '@clack/prompts';
import search from '@inquirer/search';
import { CONFIG_KEYS, GLOBAL_CONFIG_PATH, WORKTREE_LIST_SIZE } from './config.ts';
import type { Stash, Worktree } from './gitUtils.ts';

/** A worktree, optionally annotated with extra hint strings. */
export type WorktreeOption = Worktree & { decorators?: string[] };

interface SearchOption<T> {
  value: T;
  label: string;
  hint?: string;
  searchText: string;
}

// ── Cancel Guard ──────────────────────────────────────────────────────────────

/**
 * Call immediately after any @clack/prompts prompt.
 * Exits cleanly if the user pressed ESC or Ctrl+C.
 */
export function guardCancel<T>(value: T | symbol, message = 'Operation cancelled.'): T {
  if (p.isCancel(value)) {
    p.cancel(message);
    process.exit(0);
  }
  return value as T;
}

// ── Wrappers ──────────────────────────────────────────────────────────────────

export const intro = (title?: string) => p.intro(title);
export const outro = (msg?: string) => p.outro(msg);
export const logInfo = (msg: string) => p.log.info(msg);
export const logWarn = (msg: string) => p.log.warn(msg);
export const logError = (msg: string) => p.log.error(msg);
export const logSuccess = (msg: string) => p.log.success(msg);

/**
 * Creates a spinner. Usage:
 *   const s = spinner();
 *   s.start('Loading...');
 *   s.stop('Done.');
 */
export const spinner = () => p.spinner();

// ── Fuzzy Search Helper ───────────────────────────────────────────────────────

function fuzzyMatch(input: string | undefined, target: string): boolean {
  if (!input) return true;
  const q = input.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

async function searchSelect<T>(message: string, options: SearchOption<T>[]): Promise<T> {
  // @inquirer/search has no ESC handling, so abort the prompt on a bare Escape keypress
  const controller = new AbortController();
  const onKeypress = (_str: unknown, key?: { name?: string }) => {
    if (key?.name === 'escape') controller.abort();
  };
  process.stdin.on('keypress', onKeypress);

  try {
    return await search(
      {
        message,
        pageSize: WORKTREE_LIST_SIZE === 0 ? Math.max(options.length, 1) : WORKTREE_LIST_SIZE,
        source: (input) =>
          options
            .filter((o) => fuzzyMatch(input, o.searchText))
            .map((o) => ({ name: o.label, value: o.value, description: o.hint })),
      },
      { signal: controller.signal },
    );
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'ExitPromptError' || err.name === 'AbortPromptError')
    ) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    throw err;
  } finally {
    process.stdin.off('keypress', onKeypress);
  }
}

// ── Checkout Prompts ──────────────────────────────────────────────────────────

/**
 * Shown when the user wants to checkout but has uncommitted changes.
 */
export async function promptUncommittedChanges(
  branch?: string,
): Promise<'add-and-stash' | 'stash' | 'force'> {
  const action = await p.select<'add-and-stash' | 'stash' | 'force'>({
    message: `You have uncommitted changes. What should happen before checking out ${branch ? `"${branch}"` : 'the branch'}?`,
    options: [
      { value: 'add-and-stash', label: 'Add all untracked files, then stash' },
      { value: 'stash', label: 'Stash tracked changes only, then checkout' },
      { value: 'force', label: 'Force checkout (discard uncommitted changes)' },
    ],
  });
  return guardCancel(action);
}

/**
 * Prompts the user to enter a branch name (used when none was provided as an arg).
 */
export async function promptBranchName(): Promise<string> {
  const name = await p.text({
    message: 'Branch name:',
    validate: (v) => (!v?.trim() ? 'Branch name cannot be empty.' : undefined),
  });
  return guardCancel(name);
}

// ── Stash Prompts ─────────────────────────────────────────────────────────────

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

// ── Worktree Prompts ──────────────────────────────────────────────────────────

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
 * Displays worktrees and lets the user select one.
 */
export async function promptSelectWorktree(worktrees: WorktreeOption[]): Promise<WorktreeOption> {
  return searchSelect('Select a worktree:', worktrees.map(toWorktreeOption));
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
 * Displays non-main worktrees and lets the user select one to rename.
 */
export async function promptSelectWorktreeForRename(
  worktrees: WorktreeOption[],
): Promise<WorktreeOption> {
  return searchSelect('Select a worktree to rename:', worktrees.map(toWorktreeOption));
}

/**
 * Displays non-main worktrees and lets the user select one to re-link.
 */
export async function promptSelectWorktreeForLinkFix(
  worktrees: WorktreeOption[],
): Promise<WorktreeOption> {
  return searchSelect('Select a worktree to re-link:', worktrees.map(toWorktreeOption));
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
 * Displays worktrees and lets the user select one to pull latest changes for.
 */
export async function promptSelectWorktreeForPull(
  worktrees: WorktreeOption[],
): Promise<WorktreeOption> {
  return searchSelect('Select a worktree to pull:', worktrees.map(toWorktreeOption));
}

/**
 * Displays worktrees and lets the user select one to merge into the current branch.
 */
export async function promptSelectWorktreeForMerge(
  worktrees: WorktreeOption[],
): Promise<WorktreeOption> {
  return searchSelect(
    'Select a worktree to merge into the current branch:',
    worktrees.map(toWorktreeOption),
  );
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

// ── Config Prompts ────────────────────────────────────────────────────────────

/**
 * Iterates over all CONFIG_KEYS and prompts the user for each value.
 * `currentValues` pre-fills the text inputs so editing feels natural.
 * Empty inputs are omitted from the returned object.
 */
export async function promptConfigValues(
  currentValues: Record<string, string> = {},
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const { key, label, placeholder } of CONFIG_KEYS) {
    const value = guardCancel(
      await p.text({
        message: `${label}:`,
        placeholder,
        initialValue: currentValues[key] ?? '',
      }),
    );
    const trimmed = value?.trim();
    if (trimmed) result[key] = trimmed;
  }
  return result;
}

/**
 * Prompts the user to choose which config file to target (all three locations).
 * Returns the absolute path of the chosen file.
 */
export async function promptSelectConfigFile(): Promise<string> {
  const file = await p.select<string>({
    message: 'Which config file do you want to update?',
    options: [
      {
        value: GLOBAL_CONFIG_PATH,
        label: 'Global',
        hint: GLOBAL_CONFIG_PATH,
      },
      {
        value: path.resolve('.env'),
        label: '.env',
        hint: `${path.resolve('.env')} (project defaults, commit this)`,
      },
      {
        value: path.resolve('.env.local'),
        label: '.env.local',
        hint: `${path.resolve('.env.local')} (local overrides, do NOT commit)`,
      },
    ],
  });
  return guardCancel(file);
}

/**
 * Prompts the user to choose between `.env` and `.env.local` in the cwd.
 * Used by `config local` where global is not an option.
 */
export async function promptSelectLocalFile(): Promise<string> {
  const file = await p.select<string>({
    message: 'Which local config file do you want to create/update?',
    options: [
      {
        value: path.resolve('.env'),
        label: '.env',
        hint: 'project defaults — commit this',
      },
      {
        value: path.resolve('.env.local'),
        label: '.env.local',
        hint: 'local overrides — do NOT commit',
      },
    ],
  });
  return guardCancel(file);
}

/**
 * Prompts the user to choose a single config key to update.
 * `currentValues` is shown as hints so the user can see what's set.
 * Resolves to the chosen key string (e.g. 'GEET_BRANCH_PREFIX').
 */
export async function promptSelectConfigKey(
  currentValues: Record<string, string> = {},
): Promise<string> {
  const key = await p.select<string>({
    message: 'Which setting do you want to update?',
    options: CONFIG_KEYS.map(({ key: k, label }) => ({
      value: k,
      label,
      hint: currentValues[k] ? `current: ${currentValues[k]}` : '(not set)',
    })),
  });
  return guardCancel(key);
}

/**
 * Prompts the user to confirm an action (yes/no).
 */
export async function promptConfirm(message: string): Promise<boolean> {
  const confirmed = await p.confirm({ message });
  return guardCancel(confirmed);
}

/**
 * Prompts for an optional init-script source file path.
 * An empty value means "generate a stub template".
 */
export async function promptInitScriptSource(): Promise<string> {
  const src = await p.text({
    message: 'Path to an existing script to copy/move (leave empty to generate a stub):',
    placeholder: '~/scripts/my-init.sh',
  });
  return guardCancel<string | undefined>(src) ?? '';
}

/**
 * When an init script already exists, ask what to do.
 */
export async function promptOverrideOrSkip(): Promise<'edit' | 'override' | 'skip'> {
  const action = await p.select<'edit' | 'override' | 'skip'>({
    message: 'An init script already exists for this repo. What should we do?',
    options: [
      { value: 'edit', label: 'Edit', hint: 'open the existing script in $EDITOR' },
      { value: 'override', label: 'Override', hint: 'replace the existing script' },
      { value: 'skip', label: 'Skip', hint: 'leave the existing script unchanged' },
    ],
  });
  return guardCancel(action);
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

/**
 * When a source file is provided, ask whether to copy or move it.
 */
export async function promptCopyOrMove(): Promise<'copy' | 'move'> {
  const action = await p.select<'copy' | 'move'>({
    message: 'Copy or move the source file into ~/.geet/init/?',
    options: [
      { value: 'copy', label: 'Copy', hint: 'keep the original in place' },
      { value: 'move', label: 'Move', hint: 'remove the original after copying' },
    ],
  });
  return guardCancel(action);
}

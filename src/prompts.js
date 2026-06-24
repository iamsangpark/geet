/**
 * prompts.js
 * Reusable @clack/prompts helpers.
 *
 * Key convention: every prompt result must be passed through guardCancel().
 * If the user presses ESC or Ctrl+C, @clack/prompts resolves the promise to
 * a special Symbol. isCancel() detects it, and guardCancel() calls p.cancel()
 * then process.exit(0) — a clean exit with no error.
 */

import path from 'path';
import os from 'os';
import * as p from '@clack/prompts';
import { CONFIG_KEYS, GLOBAL_CONFIG_PATH } from './config.js';

// ── Cancel Guard ──────────────────────────────────────────────────────────────

/**
 * Call immediately after any @clack/prompts prompt.
 * Exits cleanly if the user pressed ESC or Ctrl+C.
 */
export function guardCancel(value, message = 'Operation cancelled.') {
  if (p.isCancel(value)) {
    p.cancel(message);
    process.exit(0);
  }
  return value;
}

// ── Wrappers ──────────────────────────────────────────────────────────────────

export const intro = (title) => p.intro(title);
export const outro = (msg) => p.outro(msg);
export const logInfo = (msg) => p.log.info(msg);
export const logWarn = (msg) => p.log.warn(msg);
export const logError = (msg) => p.log.error(msg);
export const logSuccess = (msg) => p.log.success(msg);

/**
 * Creates a spinner. Usage:
 *   const s = spinner();
 *   s.start('Loading...');
 *   s.stop('Done.');
 */
export const spinner = () => p.spinner();

// ── Checkout Prompts ──────────────────────────────────────────────────────────

/**
 * Shown when the user wants to checkout but has uncommitted changes.
 * @returns {'add-and-stash' | 'stash' | 'force'}
 */
export async function promptUncommittedChanges(branch) {
  const action = await p.select({
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
 * @returns {string}
 */
export async function promptBranchName() {
  const name = await p.text({
    message: 'Branch name:',
    validate: (v) => (!v.trim() ? 'Branch name cannot be empty.' : undefined),
  });
  return guardCancel(name);
}

// ── Stash Prompts ─────────────────────────────────────────────────────────────

/**
 * Shown before `stash pop` when there are uncommitted changes.
 * @returns {'add-and-stash' | 'stash-first' | 'pop-anyway'}
 */
export async function promptUncommittedChangesForPop() {
  const action = await p.select({
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
 * @returns {string}
 */
export async function promptStashMessage() {
  const message = await p.text({
    message: 'Stash message (optional, press Enter to skip):',
    placeholder: 'WIP: my changes',
  });
  return guardCancel(message);
}

/**
 * Displays all stashes and lets the user select one.
 * @param {Array<{ index: number, name: string, date: string, ref: string }>} stashes
 * @returns {{ index: number, name: string, date: string, ref: string }}
 */
export async function promptSelectStash(stashes) {
  const selected = await p.select({
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
 * Displays worktrees and lets the user select one.
 * @param {Array<{ path: string, branch: string, commit: string, isMain: boolean }>} worktrees
 * @returns {{ path: string, branch: string, commit: string, isMain: boolean }}
 */
export async function promptSelectWorktree(worktrees) {
  const selected = await p.select({
    message: 'Select a worktree:',
    options: worktrees.map((w) => ({
      value: w,
      label: w.branch,
    })),
  });
  return guardCancel(selected);
}

/**
 * Displays non-main worktrees and lets the user select one to remove.
 * @param {Array<{ path: string, branch: string, commit: string, isMain: boolean }>} worktrees
 * @returns {{ path: string, branch: string, commit: string, isMain: boolean }}
 */
export async function promptSelectWorktreeForRemove(worktrees) {
  const selected = await p.select({
    message: 'Select a worktree to remove:',
    options: worktrees.map((w) => ({
      value: w,
      label: w.branch,
      hint: w.path,
    })),
  });
  return guardCancel(selected);
}

/**
 * Displays non-main worktrees and lets the user select one to rename.
 * @param {Array<{ path: string, branch: string, commit: string, isMain: boolean }>} worktrees
 * @returns {{ path: string, branch: string, commit: string, isMain: boolean }}
 */
export async function promptSelectWorktreeForRename(worktrees) {
  const selected = await p.select({
    message: 'Select a worktree to rename:',
    options: worktrees.map((w) => ({
      value: w,
      label: w.branch,
      hint: w.path,
    })),
  });
  return guardCancel(selected);
}

/**
 * Multiselect: all stale worktrees pre-selected; user can deselect any to keep.
 * @param {Array<{ path: string, branch: string, commit: string, isMain: boolean }>} worktrees
 * @returns {Array<{ path: string, branch: string, commit: string, isMain: boolean }>}
 */
export async function promptMultiSelectWorktreesForPrune(worktrees) {
  const selected = await p.multiselect({
    message: 'Select worktrees to prune (space to toggle, enter to confirm):',
    options: worktrees.map((w) => ({
      value: w,
      label: w.branch,
      hint: w.path,
    })),
    initialValues: worktrees,
  });
  return guardCancel(selected);
}

/**
 * Prompts for smart-add inputs.
 * Pass `mappedProjectName` to skip the project name prompt and use the mapping.
 *
 * @param {string} [mappedProjectName]
 * @returns {{ projectName: string, jiraName: string, description: string }}
 */
export async function promptWorktreeProjectName(mappedProjectName) {
  let projectName = mappedProjectName;
  if (!projectName) {
    projectName = await p.text({
      message: 'Project name:',
      placeholder: 'my-project',
      validate: (v) => (!v.trim() ? 'Project name cannot be empty.' : undefined),
    });
    guardCancel(projectName);
  }
  return { projectName };
}

export async function promptWorktreeSmartAdd(mappedProjectName, initialValues = {}) {
  let projectName = mappedProjectName;

  if (!projectName) {
    projectName = await p.text({
      message: 'Project name:',
      placeholder: 'my-project',
      initialValue: initialValues.projectName,
      validate: (v) => (!v.trim() ? 'Project name cannot be empty.' : undefined),
    });
    guardCancel(projectName);
  }

  const jiraName = await p.text({
    message: 'Jira ticket (optional):',
    placeholder: 'PROJ-1234',
    initialValue: initialValues.jiraName,
  });
  guardCancel(jiraName);

  const description = await p.text({
    message: 'Short description:',
    placeholder: 'add-login-page',
    initialValue: initialValues.description,
    validate: (v) => (!v.trim() ? 'Description cannot be empty.' : undefined),
  });
  guardCancel(description);

  return { projectName, jiraName: jiraName?.trim() ?? '', description };
}

/**
 * Presents a select list of existing local branches not already in a worktree.
 * @param {string[]} branches
 * @returns {string} selected branch name
 */
export async function promptSelectExistingBranch(branches) {
  const branch = await p.select({
    message: 'Select existing branch:',
    options: branches.map((b) => ({ value: b, label: b })),
  });
  return guardCancel(branch);
}

// ── Config Prompts ────────────────────────────────────────────────────────────

/**
 * Iterates over all CONFIG_KEYS and prompts the user for each value.
 * `currentValues` pre-fills the text inputs so editing feels natural.
 * Empty inputs are omitted from the returned object.
 *
 * @param {Record<string, string>} currentValues
 * @returns {Promise<Record<string, string>>}
 */
export async function promptConfigValues(currentValues = {}) {
  const result = {};
  for (const { key, label, placeholder, hint } of CONFIG_KEYS) {
    const value = await p.text({
      message: `${label}:`,
      placeholder,
      hint,
      initialValue: currentValues[key] ?? '',
    });
    guardCancel(value);
    if (value.trim()) result[key] = value.trim();
  }
  return result;
}

/**
 * Prompts the user to choose which config file to target (all three locations).
 * Returns the absolute path of the chosen file.
 *
 * @returns {Promise<string>}
 */
export async function promptSelectConfigFile() {
  const file = await p.select({
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
 *
 * @returns {Promise<string>}
 */
export async function promptSelectLocalFile() {
  const file = await p.select({
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
 *
 * @param {Record<string, string>} currentValues
 * @returns {Promise<string>}  — the chosen key string (e.g. 'GEET_BRANCH_PREFIX')
 */
export async function promptSelectConfigKey(currentValues = {}) {
  const key = await p.select({
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
 *
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function promptConfirm(message) {
  const confirmed = await p.confirm({ message });
  return guardCancel(confirmed);
}

/**
 * Prompts for an optional init-script source file path.
 * An empty value means "generate a stub template".
 *
 * @returns {Promise<string>}
 */
export async function promptInitScriptSource() {
  const src = await p.text({
    message: 'Path to an existing script to copy/move (leave empty to generate a stub):',
    placeholder: '~/scripts/my-init.sh',
  });
  return guardCancel(src) ?? '';
}

/**
 * When an init script already exists, ask what to do.
 *
 * @returns {Promise<'override' | 'skip'>}
 */
export async function promptOverrideOrSkip() {
  const action = await p.select({
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
 * When a source file is provided, ask whether to copy or move it.
 *
 * @returns {Promise<'copy' | 'move'>}
 */
export async function promptCopyOrMove() {
  const action = await p.select({
    message: 'Copy or move the source file into ~/.geet/init/?',
    options: [
      { value: 'copy', label: 'Copy', hint: 'keep the original in place' },
      { value: 'move', label: 'Move', hint: 'remove the original after copying' },
    ],
  });
  return guardCancel(action);
}

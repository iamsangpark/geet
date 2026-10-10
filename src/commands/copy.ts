/**
 * commands/copy.ts
 * Implements:
 *   geet copy path | worktree  — copy the current worktree folder path
 *   geet copy jira             — copy the Jira ticket key (e.g. PROJ-1234)
 *   geet copy branch           — copy the current branch name
 */

import path from 'path';
import { listWorktrees, getCurrentBranch } from '../utils/git.ts';
import { GeetError } from '../utils/errors.ts';
import { intro, outro, logSuccess } from '../prompts.ts';

const JIRA_KEY = /[A-Z][A-Z0-9]*-\d+/;

function fail(message: string): GeetError {
  return new GeetError(message);
}

async function copyToClipboard(value: string) {
  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(value);
  logSuccess(`Copied to clipboard: ${value}`);
}

async function currentWorktree() {
  const worktrees = await listWorktrees();
  const cwd = process.cwd();
  const current = worktrees.find((w) => cwd === w.path || cwd.startsWith(w.path + path.sep));
  if (!current) throw fail('Could not determine the current worktree path.');
  return current;
}

// ── copy path | worktree ──────────────────────────────────────────────────────

export async function copyPathAction() {
  intro('geet copy path');
  const current = await currentWorktree();
  await copyToClipboard(current.path);
  outro('Done.');
}

// ── copy branch ───────────────────────────────────────────────────────────────

export async function copyBranchAction() {
  intro('geet copy branch');
  const branch = await getCurrentBranch();
  if (branch === 'HEAD') throw fail('HEAD is detached; there is no current branch.');
  await copyToClipboard(branch);
  outro('Done.');
}

// ── copy jira ─────────────────────────────────────────────────────────────────

/**
 * Looks for a Jira key in the branch name first, then in the worktree folder
 * name (worktrees are created as <jiraName>-<description>).
 */
export async function copyJiraAction() {
  intro('geet copy jira');

  const branch = await getCurrentBranch();
  let key = branch.match(JIRA_KEY)?.[0];

  if (!key) {
    const current = await currentWorktree();
    key = path.basename(current.path).match(JIRA_KEY)?.[0];
  }

  if (!key) throw fail('No Jira ticket found in the current branch or worktree folder name.');

  await copyToClipboard(key);
  outro('Done.');
}

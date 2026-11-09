/**
 * commands/worktree/base.ts
 * Implements the `geet worktree base` group — work with the branch the current branch
 * was created from:
 *   base          — show the base and how far the current branch is from it
 *   base show     — print just the base branch name
 *   base set      — record the base branch
 *   base pull     — fast-forward the base from origin (even if checked out in another worktree)
 *   base merge    — merge the base into the current branch
 *   base rebase   — rebase the current branch onto the base
 *   base open     — open the worktree that has the base checked out
 */

import path from 'path';
import type { Command } from 'commander';
import { GeetError } from '../../utils/errors.ts';
import { describeWithSubcommands } from '../../utils/commander.ts';
import {
  countBehindAhead,
  listAllLocalBranches,
  listWorktrees,
  mergeBranch,
  rebaseOnto,
  setBranchBase,
} from '../../utils/git.ts';
import { copyToClipboard } from '../../utils/clipboard.ts';
import { intro, outro, logInfo, spinner } from '../../prompts/common.ts';
import { guardBeforeMerge } from './pullMerge.ts';
import { openHerdrWorkspaces, openWorktree } from './utils/openWorktree.ts';
import {
  pullBase,
  requireCurrentBranch,
  resolveBase,
  selectBase,
  type BaseSource,
} from './utils/baseBranch.ts';

interface PullOptions {
  pull?: boolean;
  force?: boolean;
}

const SOURCE_LABEL: Record<BaseSource, string> = {
  recorded: 'recorded',
  reflog: 'detected from history',
  selected: 'selected just now',
};

/**
 * Runs `task` behind a spinner; on failure the spinner is closed (so clack doesn't print
 * "Canceled") before the error propagates to the top-level handler.
 */
async function withSpinner(start: string, done: string, task: () => Promise<unknown>) {
  const s = spinner();
  s.start(start);
  try {
    await task();
  } catch (err) {
    s.stop('Failed.');
    throw err;
  }
  s.stop(done);
}

const pullBaseWithSpinner = (base: string, force: boolean | undefined) =>
  withSpinner(`Pulling latest for "${base}"...`, `"${base}" is up to date.`, () =>
    pullBase(base, { force }),
  );

// ── base ──────────────────────────────────────────────────────────────────────

export async function worktreeBaseShowAction() {
  intro('geet wt base');

  const { current, base, source } = await resolveBase();
  const [behind, ahead] = await countBehindAhead(base, current);
  const inWorktree = (await listWorktrees()).find((w) => w.branch === base);

  logInfo(`Branch:   ${current}`);
  logInfo(`Base:     ${base} (${SOURCE_LABEL[source]})`);
  logInfo(`Worktree: ${inWorktree ? inWorktree.path : 'base is not checked out'}`);
  logInfo(`Status:   ${behind} behind, ${ahead} ahead of ${base}`);

  outro('Done.');
}

// ── base show ─────────────────────────────────────────────────────────────────

/** Prints only the base branch name, with no decoration, so it works in scripts. */
export async function worktreeBaseShowNameAction() {
  const { base } = await resolveBase();
  console.log(base);
}

// ── base set ──────────────────────────────────────────────────────────────────

export async function worktreeBaseSetAction(branch?: string) {
  intro('geet wt base set');

  const current = await requireCurrentBranch();
  const base = branch ?? (await selectBase(current));

  if (base === current) {
    throw new GeetError(`"${current}" can't be its own base.`);
  }
  if (!(await listAllLocalBranches()).includes(base)) {
    throw new GeetError(`Local branch "${base}" not found.`);
  }

  await setBranchBase(current, base);
  outro(`Base of "${current}" is now "${base}".`);
}

// ── base pull ─────────────────────────────────────────────────────────────────

export async function worktreeBasePullAction(options: PullOptions) {
  intro('geet wt base pull');

  const { base } = await resolveBase();
  await pullBaseWithSpinner(base, options.force);

  outro('Done.');
}

// ── base merge / rebase ───────────────────────────────────────────────────────

async function syncWithBase(kind: 'merge' | 'rebase', options: PullOptions) {
  intro(`geet wt base ${kind}`);

  const { current, base } = await resolveBase();

  // Pull first so a refused/failed pull happens before the user's changes are stashed.
  if (options.pull !== false) await pullBaseWithSpinner(base, options.force);

  await guardBeforeMerge();

  if (kind === 'merge') {
    await withSpinner(
      `Merging "${base}" into "${current}"...`,
      `Merged "${base}" into "${current}".`,
      () => mergeBranch(base),
    );
  } else {
    await withSpinner(
      `Rebasing "${current}" onto "${base}"...`,
      `Rebased "${current}" onto "${base}".`,
      () => rebaseOnto(base),
    );
  }

  outro('Done.');
}

export const worktreeBaseMergeAction = (options: PullOptions) => syncWithBase('merge', options);
export const worktreeBaseRebaseAction = (options: PullOptions) => syncWithBase('rebase', options);

// ── base open ─────────────────────────────────────────────────────────────────

export async function worktreeBaseOpenAction() {
  intro('geet wt base open');

  const { base } = await resolveBase();
  const worktrees = await listWorktrees();
  const target = worktrees.find((w) => w.branch === base);
  if (!target) {
    throw new GeetError(
      `"${base}" is not checked out in any worktree. Run "geet wt add" to create one.`,
    );
  }

  const mainPath = worktrees.find((w) => w.isMain)?.path;
  const openWorkspaces = await openHerdrWorkspaces(mainPath);

  await copyToClipboard(target.path, 'Path copied to clipboard');
  await openWorktree(target.path, mainPath, {
    alreadyOpen: openWorkspaces.has(path.resolve(target.path)),
  });
}

// ── registration ──────────────────────────────────────────────────────────────

export function registerWorktreeBaseCommand(worktreeCmd: Command) {
  const baseCmd = worktreeCmd.command('base').action((_options, cmd) => {
    if (cmd.args.length > 0) {
      throw new GeetError(
        `Unknown subcommand: "${cmd.args[0]}". Run "geet worktree base --help" to see available subcommands.`,
      );
    }
    return worktreeBaseShowAction();
  });

  const forceOption = [
    '--force',
    "Pull even if the base branch's worktree has uncommitted changes",
  ] as const;

  baseCmd
    .command('show')
    .description('Print the base branch name of the current branch')
    .action(worktreeBaseShowNameAction);

  baseCmd
    .command('pull')
    .description(
      'Fast-forward the base branch from origin, even if it is checked out in a worktree',
    )
    .option(...forceOption)
    .action(worktreeBasePullAction);

  baseCmd
    .command('merge')
    .description('Pull the base branch, then merge it into the current branch')
    .option('--no-pull', 'Merge the local base branch without pulling it first')
    .option(...forceOption)
    .action(worktreeBaseMergeAction);

  baseCmd
    .command('rebase')
    .description('Pull the base branch, then rebase the current branch onto it')
    .option('--no-pull', 'Rebase onto the local base branch without pulling it first')
    .option(...forceOption)
    .action(worktreeBaseRebaseAction);

  baseCmd
    .command('open')
    .description('Open the worktree that has the base branch checked out')
    .action(worktreeBaseOpenAction);

  baseCmd
    .command('set [branch]')
    .description('Record the base branch of the current branch (prompts when omitted)')
    .action(worktreeBaseSetAction);

  describeWithSubcommands(
    baseCmd,
    'Show or manage the base branch the current branch was created from',
  );
}

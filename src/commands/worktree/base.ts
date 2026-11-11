/**
 * commands/worktree/base.ts
 * Implements the `geet worktree base` group — work with the branch the current branch
 * was created from:
 *   base          — show the base and how far the current branch is from it
 *   base show     — print just the base branch name
 *   base set      — record the base branch
 *   base pull     — fast-forward the base from origin (even if checked out in another worktree;
 *                   --chain: every base in the chain)
 *   base push     — push the base to origin (--chain: every branch in the chain)
 *   base merge    — merge the base into the current branch (--chain: the whole chain of bases)
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
  pushBranch,
  rebaseOnto,
  setBranchBase,
} from '../../utils/git.ts';
import { copyToClipboard } from '../../utils/clipboard.ts';
import { intro, outro, logInfo, withSpinner } from '../../prompts/common.ts';
import { guardBeforeMerge } from './pullMerge.ts';
import { mergeChain, pullChain, pushChain } from './utils/baseChain.ts';
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

export async function worktreeBasePullAction(options: PullOptions & { chain?: boolean }) {
  if (options.chain) return pullChain(options);
  intro('geet wt base pull');

  const { base } = await resolveBase();
  await pullBaseWithSpinner(base, options.force);

  outro('Done.');
}

// ── base push ─────────────────────────────────────────────────────────────────

export async function worktreeBasePushAction(options: { chain?: boolean }) {
  if (options.chain) return pushChain();
  intro('geet wt base push');

  const { base } = await resolveBase();
  await withSpinner(`Pushing "${base}"...`, `Pushed "${base}".`, () => pushBranch(base));

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

export const worktreeBaseMergeAction = (options: PullOptions & { chain?: boolean }) =>
  options.chain ? mergeChain(options) : syncWithBase('merge', options);
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
    .option('--chain', 'Pull every base in the chain up to a root, root first')
    .option(...forceOption)
    .action(worktreeBasePullAction);

  baseCmd
    .command('push')
    .description('Push the base branch to origin')
    .option('--chain', 'Push every branch in the chain, root first, including the current one')
    .action(worktreeBasePushAction);

  baseCmd
    .command('merge')
    .description('Pull the base branch, then merge it into the current branch')
    .option('--no-pull', 'Merge the local base branch without pulling it first')
    .option(
      '--chain',
      'Walk the chain of bases up to a root, then merge each into its child, root first',
    )
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

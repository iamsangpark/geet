/**
 * commands/worktree/utils/baseChain.ts
 * `geet wt base merge --chain`: walk the recorded bases from the current branch up to a
 * root, then pull and merge each link into its child, root first.
 */

import os from 'os';
import { GeetError, userMessage } from '../../../utils/errors.ts';
import {
  countBehindAhead,
  fastForwardBranch,
  fetchAll,
  getBranchBase,
  getWorktreeChanges,
  guessBranchBase,
  listWorktrees,
  localBranchExists,
  mergeBranch,
  pushBranch,
  remoteTrackingExists,
  setBranchBase,
  type Worktree,
} from '../../../utils/git.ts';
import { stashCurrentChanges } from '../../../utils/stashChanges.ts';
import {
  intro,
  logInfo,
  logWarn,
  outro,
  promptConfirm,
  withSpinner,
} from '../../../prompts/common.ts';
import {
  promptChainMissingBase,
  promptUncommittedChangesForMerge,
} from '../../../prompts/worktree.ts';
import { requireCurrentBranch, selectBase } from './baseBranch.ts';

export interface ChainLink {
  branch: string;
  /** Worktree that has the branch checked out, if any. */
  path?: string;
}

interface ChainOptions {
  pull?: boolean;
  force?: boolean;
}

interface StashRecord {
  branch: string;
  path: string;
  message: string;
}

const worktreePath = (worktrees: Worktree[], branch: string) =>
  worktrees.find((w) => w.branch === branch)?.path;

const tildify = (p: string) => {
  const home = os.homedir();
  return p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
};

/** The "Current chain" block: current branch first, root last. */
export function formatChain(chain: string[], worktrees: Worktree[]): string {
  const labels = chain.map((b, i) => (i === 0 ? `${b} (current)` : b));
  const width = Math.max(...labels.map((l) => l.length));
  const lines = chain.map((b, i) => {
    const p = worktreePath(worktrees, b);
    return `  ${labels[i]!.padEnd(width)}  ${p ? tildify(p) : 'not checked out'}`;
  });
  return `Current chain:\n${lines.join('\n')}`;
}

/**
 * Follows the recorded bases from the current branch until the user declares a root.
 * Returns the branches current-first (`[current, …, root]`). A branch with no usable base
 * prompts: end here, use the base detected from history, or pick one (which is recorded).
 */
export async function resolveChain(worktrees: Worktree[]): Promise<string[]> {
  const chain = [await requireCurrentBranch()];

  for (;;) {
    const branch = chain[chain.length - 1]!;
    const recorded = await getBranchBase(branch);

    if (recorded) {
      if (chain.includes(recorded)) {
        throw new GeetError(
          `${[...chain, recorded].map((b) => `"${b}"`).join(' → ')} forms a cycle; ` +
            'fix it with "geet wt base set".',
        );
      }
      if (await localBranchExists(recorded)) {
        chain.push(recorded);
        continue;
      }
      logWarn(`Base "${recorded}" of "${branch}" no longer exists locally.`);
    }

    logInfo(formatChain(chain, worktrees));

    const guessed = await guessBranchBase(branch);
    const detected =
      guessed && !chain.includes(guessed) && (await localBranchExists(guessed))
        ? guessed
        : undefined;

    const choice = await promptChainMissingBase(branch, {
      detected,
      allowRoot: chain.length > 1,
      pickBase: () => selectBase(branch),
    });
    if (choice.kind === 'root') return chain;

    if (chain.includes(choice.base)) {
      throw new GeetError(
        `"${choice.base}" is already in the chain, so it can't also be the base of "${branch}".`,
      );
    }
    await setBranchBase(branch, choice.base);
    chain.push(choice.base);
  }
}

/**
 * Turns a current-first chain into root-first links with their worktrees. For a merge,
 * every branch that gets merged into needs a worktree; the root is only fast-forwarded, so
 * it doesn't. Pull and push work on refs and need no worktrees (`requireWorktrees: false`).
 */
export function planChain(
  chain: string[],
  worktrees: Worktree[],
  { requireWorktrees = true }: { requireWorktrees?: boolean } = {},
): ChainLink[] {
  const links = [...chain]
    .reverse()
    .map((branch) => ({ branch, path: worktreePath(worktrees, branch) }));

  const missing = requireWorktrees ? links.slice(1).filter((l) => !l.path) : [];
  if (missing.length > 0) {
    const names = missing.map((l) => `"${l.branch}"`).join(', ');
    throw new GeetError(
      `${names} ${missing.length === 1 ? 'is' : 'are'} not checked out in any worktree, and ` +
        'merging into it needs one. Run "geet wt add" to check it out, then re-run ' +
        '"geet wt base merge --chain".',
    );
  }
  return links;
}

type DirtyAction = 'add-and-stash' | 'stash-first' | 'merge-anyway';

/** Asks what to do about each dirty worktree in the chain (nothing is changed yet). */
async function collectDirtyActions(links: ChainLink[], force: boolean) {
  const actions = new Map<ChainLink, DirtyAction>();
  for (const link of links) {
    if (!link.path) continue;
    const changes = await getWorktreeChanges(link.path);
    if (changes.length === 0) continue;

    logWarn(
      `Uncommitted changes in ${link.branch} (${tildify(link.path)}):\n${changes.join('\n')}`,
    );
    actions.set(
      link,
      force
        ? 'merge-anyway'
        : await promptUncommittedChangesForMerge({
            message: `How should we proceed with "${link.branch}"?`,
          }),
    );
  }
  return actions;
}

function logStashes(stashes: StashRecord[]) {
  if (stashes.length === 0) return;
  const lines = stashes.map((s) => `  ${s.branch}  ${tildify(s.path)}  "${s.message}"`);
  logInfo(
    `Stashed while syncing — restore with "git stash pop" in that worktree:\n${lines.join('\n')}`,
  );
}

async function pullLinks(links: ChainLink[], failHint: string) {
  await withSpinner('Fetching...', 'Fetched.', () => fetchAll());

  // The last link is the current branch; like single-branch mode, it isn't pulled.
  for (const link of links.slice(0, -1)) {
    if (!(await remoteTrackingExists(link.branch))) {
      logInfo(`"${link.branch}" has no remote branch; using the local branch.`);
      continue;
    }
    const done = `"${link.branch}" is up to date.`;
    try {
      // Dirty worktrees were handled up front, so this fast-forwards in place.
      await withSpinner(`Pulling latest for "${link.branch}"...`, done, () =>
        fastForwardBranch(link.branch, link.path),
      );
    } catch (err) {
      throw new GeetError(
        `Could not pull "${link.branch}" from origin: ${userMessage(err)}\n${failHint}`,
      );
    }
  }
}

async function mergeLinks(links: ChainLink[]) {
  for (let i = 1; i < links.length; i++) {
    const parent = links[i - 1]!.branch;
    const child = links[i]!;

    const [behind] = await countBehindAhead(parent, child.branch);
    if (behind === 0) {
      logInfo(`"${child.branch}" already contains "${parent}".`);
      continue;
    }

    const noun = behind === 1 ? 'commit' : 'commits';
    try {
      await withSpinner(
        `Merging "${parent}" into "${child.branch}"...`,
        `Merged "${parent}" into "${child.branch}" (${behind} new ${noun}).`,
        () => mergeBranch(parent, { dir: child.path }),
      );
    } catch (err) {
      throw new GeetError(
        `Merge of "${parent}" into "${child.branch}" failed in ${tildify(child.path!)}: ` +
          `${userMessage(err)}\nResolve and commit there, then re-run ` +
          '"geet wt base merge --chain" to continue.',
      );
    }
  }
}

/**
 * Applies the stash choices made up front, then runs `task`. The stashes created are listed
 * afterwards, also when `task` (or a later stash) fails.
 */
async function stashThen(dirty: Map<ChainLink, DirtyAction>, task: () => Promise<void>) {
  const stashes: StashRecord[] = [];
  try {
    for (const [link, action] of dirty) {
      if (action === 'merge-anyway' || !link.path) continue;
      const message = `geet chain: ${link.branch}`;
      await stashCurrentChanges({
        includeUntracked: action === 'add-and-stash',
        dir: link.path,
        message,
      });
      stashes.push({ branch: link.branch, path: link.path, message });
    }
    await task();
  } catch (err) {
    logStashes(stashes);
    throw err;
  }
  logStashes(stashes);
}

const arrow = (links: ChainLink[]) => links.map((l) => l.branch).join(' → ');

/**
 * `geet wt base merge --chain`.
 */
export async function mergeChain({ pull = true, force = false }: ChainOptions) {
  intro('geet wt base merge --chain');

  const worktrees = await listWorktrees();
  const links = planChain(await resolveChain(worktrees), worktrees);

  const dirty = await collectDirtyActions(links, force);

  if (!(await promptConfirm(`Merge ${arrow(links)}?`))) {
    outro('Cancelled.');
    return;
  }

  await stashThen(dirty, async () => {
    if (pull) {
      await pullLinks(
        links,
        'No branches were merged. Fix it (e.g. push or merge the origin branch yourself), ' +
          'then re-run, or pass --no-pull to merge the local branches as they are.',
      );
    }
    await mergeLinks(links);
  });
  outro('Done.');
}

/**
 * `geet wt base pull --chain`: fast-forwards every base in the chain from origin, root first.
 * The current branch is left alone, as with a plain `base pull`.
 */
export async function pullChain({ force = false }: ChainOptions) {
  intro('geet wt base pull --chain');

  const worktrees = await listWorktrees();
  const links = planChain(await resolveChain(worktrees), worktrees, { requireWorktrees: false });
  const pulled = links.slice(0, -1);

  const dirty = await collectDirtyActions(pulled, force);

  if (!(await promptConfirm(`Pull ${arrow(pulled)}?`))) {
    outro('Cancelled.');
    return;
  }

  await stashThen(dirty, () =>
    pullLinks(links, 'Branches before it in the chain were already pulled.'),
  );
  outro('Done.');
}

/**
 * `geet wt base push --chain`: pushes every branch in the chain to origin, root first.
 * Pushes are never forced, so a branch that has diverged from origin stops the run.
 */
export async function pushChain() {
  intro('geet wt base push --chain');

  const worktrees = await listWorktrees();
  const links = planChain(await resolveChain(worktrees), worktrees, { requireWorktrees: false });

  if (!(await promptConfirm(`Push ${arrow(links)} to origin?`))) {
    outro('Cancelled.');
    return;
  }

  await withSpinner('Fetching...', 'Fetched.', () => fetchAll());

  for (const link of links) {
    if (await isPushed(link.branch)) {
      logInfo(`"${link.branch}" is already up to date on origin.`);
      continue;
    }
    try {
      await withSpinner(`Pushing "${link.branch}"...`, `Pushed "${link.branch}".`, () =>
        pushBranch(link.branch),
      );
    } catch (err) {
      throw new GeetError(
        `Could not push "${link.branch}": ${userMessage(err)}\n` +
          'If origin has newer commits, run "geet wt base pull --chain" (or merge them) and re-run.',
      );
    }
  }
  outro('Done.');
}

/** True when origin/<branch> exists and points at the same commit as the local branch. */
async function isPushed(branch: string): Promise<boolean> {
  if (!(await remoteTrackingExists(branch))) return false;
  const [behind, ahead] = await countBehindAhead(`origin/${branch}`, branch);
  return behind === 0 && ahead === 0;
}

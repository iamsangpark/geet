/**
 * commands/worktree/utils/baseChain.ts
 * `geet wt base merge --chain`: walk the recorded bases from the current branch up to a
 * root, then pull and merge each link into its child, root first.
 * `--tree` is the mirror image: walk down from the current branch to every worktree whose
 * recorded base leads back to it (breadth first), then act on that tree, parents first.
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

/** A branch in the tree below the current branch. `parent` is unset for the current branch. */
export interface TreeNode extends ChainLink {
  parent?: string;
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

/** Fast-forwards each link from origin, in order. Callers leave the current branch out. */
async function pullLinks(links: ChainLink[], failHint: string) {
  await withSpinner('Fetching...', 'Fetched.', () => fetchAll());

  for (const link of links) {
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

interface MergeStep {
  parent: string;
  child: ChainLink;
}

/** Merges each step's parent into its child, in order. `rerun` is the command to retry. */
async function mergeSteps(steps: MergeStep[], rerun: string) {
  for (const { parent, child } of steps) {
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
          `"${rerun}" to continue.`,
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

const count = (n: number) => `${n} ${n === 1 ? 'branch' : 'branches'}`;

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
      // The last link is the current branch; like single-branch mode, it isn't pulled.
      await pullLinks(
        links.slice(0, -1),
        'No branches were merged. Fix it (e.g. push or merge the origin branch yourself), ' +
          'then re-run, or pass --no-pull to merge the local branches as they are.',
      );
    }
    await mergeSteps(
      links.slice(1).map((child, i) => ({ parent: links[i]!.branch, child })),
      'geet wt base merge --chain',
    );
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
    pullLinks(pulled, 'Branches before it in the chain were already pulled.'),
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

  await confirmAndPush(links, 'geet wt base pull --chain');
}

interface PendingPush {
  branch: string;
  /** Commits origin lacks; undefined when the branch is not on origin yet. */
  ahead?: number;
  /** Commits origin has that the branch lacks (a push will be rejected when > 0). */
  behind: number;
}

/** Fetches, then lists the links with local commits that a push would send to origin. */
async function findPendingPushes(links: ChainLink[]): Promise<PendingPush[]> {
  await withSpinner('Fetching...', 'Fetched.', () => fetchAll());

  const pending: PendingPush[] = [];
  for (const { branch } of links) {
    if (!(await remoteTrackingExists(branch))) {
      pending.push({ branch, behind: 0 });
      continue;
    }
    const [behind, ahead] = await countBehindAhead(`origin/${branch}`, branch);
    if (ahead > 0) pending.push({ branch, ahead, behind });
  }
  return pending;
}

function formatPendingPushes(pending: PendingPush[]): string {
  const width = Math.max(...pending.map((p) => p.branch.length));
  const lines = pending.map((p) => {
    const note =
      p.ahead === undefined
        ? 'new on origin'
        : `${p.ahead} ${p.ahead === 1 ? 'commit' : 'commits'} to push` +
          (p.behind > 0 ? ` (origin has ${p.behind} you lack — push will be rejected)` : '');
    return `  ${p.branch.padEnd(width)}  ${note}`;
  });
  return `Branches with changes to push:\n${lines.join('\n')}`;
}

/**
 * Shows which links would actually change origin, asks once for all of them, then pushes
 * them in order. Links already matching origin are left out of the list and the push.
 */
async function confirmAndPush(links: ChainLink[], pullCommand: string) {
  const pending = await findPendingPushes(links);
  if (pending.length === 0) {
    outro('Nothing to push; every branch is up to date on origin.');
    return;
  }

  logInfo(formatPendingPushes(pending));
  if (!(await promptConfirm(`Push ${count(pending.length)} to origin?`, { initialValue: false }))) {
    outro('Cancelled.');
    return;
  }

  for (const { branch } of pending) {
    try {
      await withSpinner(`Pushing "${branch}"...`, `Pushed "${branch}".`, () => pushBranch(branch));
    } catch (err) {
      throw new GeetError(
        `Could not push "${branch}": ${userMessage(err)}\n` +
          `If origin has newer commits, run "${pullCommand}" (or merge them) and re-run.`,
      );
    }
  }
  outro('Done.');
}

// ── --tree ────────────────────────────────────────────────────────────────────

/**
 * Breadth-first walk down from `root`: every worktree whose recorded base is `root`, then
 * the worktrees based on those, and so on. Returns the nodes in visiting order, root first.
 * Only recorded bases are followed, and only branches checked out in a worktree are found.
 */
export async function resolveTree(root: string, worktrees: Worktree[]): Promise<TreeNode[]> {
  const candidates: { branch: string; path: string; base?: string }[] = [];
  for (const w of worktrees) {
    if (w.branch && w.branch !== root) {
      candidates.push({ branch: w.branch, path: w.path, base: await getBranchBase(w.branch) });
    }
  }

  const nodes: TreeNode[] = [{ branch: root, path: worktreePath(worktrees, root) }];
  const seen = new Set([root]);
  for (const node of nodes) {
    for (const c of candidates) {
      if (c.base === node.branch && !seen.has(c.branch)) {
        seen.add(c.branch);
        nodes.push({ branch: c.branch, path: c.path, parent: node.branch });
      }
    }
  }
  return nodes;
}

/** The "Branch tree" block: the current branch at the top, each branch under its base. */
export function formatTree(nodes: TreeNode[]): string {
  const lines: string[] = [];
  const render = (branch: string, prefix: string, tail: string, isRoot: boolean) => {
    const node = nodes.find((n) => n.branch === branch)!;
    const where = node.path ? tildify(node.path) : 'not checked out';
    lines.push(`${prefix}${tail}${branch}${isRoot ? ' (current)' : ''}  ${where}`);
    const kids = nodes.filter((n) => n.parent === branch);
    kids.forEach((kid, i) => {
      const last = i === kids.length - 1;
      const childPrefix = isRoot ? prefix : prefix + (tail === '└─ ' ? '   ' : '│  ');
      render(kid.branch, childPrefix, last ? '└─ ' : '├─ ', false);
    });
  };
  render(nodes[0]!.branch, '  ', '', true);
  return `Branch tree:\n${lines.join('\n')}`;
}

/** Resolves and shows the tree below the current branch; undefined when it has no children. */
async function planTree(): Promise<TreeNode[] | undefined> {
  const worktrees = await listWorktrees();
  const nodes = await resolveTree(await requireCurrentBranch(), worktrees);
  if (nodes.length === 1) {
    outro(`No worktrees use "${nodes[0]!.branch}" as their base.`);
    return undefined;
  }
  logInfo(formatTree(nodes));
  return nodes;
}

/**
 * `geet wt base merge --tree`: pulls every descendant of the current branch, then merges
 * each branch into its children, parents first. The current branch is left as it is.
 */
export async function mergeTree({ pull = true, force = false }: ChainOptions) {
  intro('geet wt base merge --tree');

  const nodes = await planTree();
  if (!nodes) return;
  const below = nodes.slice(1);

  const dirty = await collectDirtyActions(below, force);

  if (!(await promptConfirm(`Merge into ${count(below.length)} as shown?`))) {
    outro('Cancelled.');
    return;
  }

  await stashThen(dirty, async () => {
    if (pull) {
      await pullLinks(
        below,
        'No branches were merged. Fix it (e.g. push or merge the origin branch yourself), ' +
          'then re-run, or pass --no-pull to merge the local branches as they are.',
      );
    }
    await mergeSteps(
      below.map((child) => ({ parent: child.parent!, child })),
      'geet wt base merge --tree',
    );
  });
  outro('Done.');
}

/**
 * `geet wt base pull --tree`: fast-forwards every descendant of the current branch from
 * origin, parents first. The current branch is left alone, as with a plain `base pull`.
 */
export async function pullTree({ force = false }: ChainOptions) {
  intro('geet wt base pull --tree');

  const nodes = await planTree();
  if (!nodes) return;
  const below = nodes.slice(1);

  const dirty = await collectDirtyActions(below, force);

  if (!(await promptConfirm(`Pull ${count(below.length)} as shown?`))) {
    outro('Cancelled.');
    return;
  }

  await stashThen(dirty, () =>
    pullLinks(below, 'Branches before it in the tree were already pulled.'),
  );
  outro('Done.');
}

/**
 * `geet wt base push --tree`: pushes the current branch and every descendant to origin,
 * parents first. Never forced, so a branch that has diverged from origin stops the run.
 */
export async function pushTree() {
  intro('geet wt base push --tree');

  const nodes = await planTree();
  if (!nodes) return;

  await confirmAndPush(nodes, 'geet wt base pull --tree');
}

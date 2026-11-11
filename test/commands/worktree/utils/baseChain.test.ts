import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/git.ts', () => ({
  countBehindAhead: vi.fn(),
  fastForwardBranch: vi.fn(),
  fetchAll: vi.fn(),
  getBranchBase: vi.fn(),
  getWorktreeChanges: vi.fn(),
  guessBranchBase: vi.fn(),
  listWorktrees: vi.fn(),
  localBranchExists: vi.fn(),
  mergeBranch: vi.fn(),
  pushBranch: vi.fn(),
  remoteTrackingExists: vi.fn(),
  setBranchBase: vi.fn(),
}));
vi.mock('../../../../src/utils/stashChanges.ts', () => ({ stashCurrentChanges: vi.fn() }));
vi.mock('../../../../src/prompts/common.ts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  promptConfirm: vi.fn(),
  withSpinner: vi.fn((_start: string, _done: string, task: () => Promise<unknown>) => task()),
}));
vi.mock('../../../../src/prompts/worktree.ts', () => ({
  promptChainMissingBase: vi.fn(),
  promptUncommittedChangesForMerge: vi.fn(),
}));
vi.mock('../../../../src/commands/worktree/utils/baseBranch.ts', () => ({
  requireCurrentBranch: vi.fn(),
  selectBase: vi.fn(),
}));

import {
  mergeChain,
  planChain,
  pullChain,
  pushChain,
  resolveChain,
} from '../../../../src/commands/worktree/utils/baseChain.ts';
import { requireCurrentBranch } from '../../../../src/commands/worktree/utils/baseBranch.ts';
import { logInfo, promptConfirm } from '../../../../src/prompts/common.ts';
import {
  promptChainMissingBase,
  promptUncommittedChangesForMerge,
} from '../../../../src/prompts/worktree.ts';
import {
  countBehindAhead,
  fastForwardBranch,
  getBranchBase,
  getWorktreeChanges,
  guessBranchBase,
  listWorktrees,
  localBranchExists,
  mergeBranch,
  pushBranch,
  remoteTrackingExists,
  setBranchBase,
} from '../../../../src/utils/git.ts';
import { stashCurrentChanges } from '../../../../src/utils/stashChanges.ts';

const wt = (branch: string, p: string) => ({ path: p, commit: 'abc', branch, isMain: false });
const WORKTREES = [wt('feat', '/wt/feat'), wt('epic', '/wt/epic')]; // develop: not checked out

const recordedBases: Record<string, string> = { feat: 'epic', epic: 'develop' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireCurrentBranch).mockResolvedValue('feat');
  vi.mocked(getBranchBase).mockImplementation(async (b) => recordedBases[b]);
  vi.mocked(localBranchExists).mockResolvedValue(true);
  vi.mocked(listWorktrees).mockResolvedValue(WORKTREES);
  vi.mocked(getWorktreeChanges).mockResolvedValue([]);
  vi.mocked(remoteTrackingExists).mockResolvedValue(true);
  vi.mocked(countBehindAhead).mockResolvedValue([2, 0]);
  vi.mocked(promptConfirm).mockResolvedValue(true);
  vi.mocked(promptChainMissingBase).mockResolvedValue({ kind: 'root' });
});

describe('resolveChain', () => {
  it('follows recorded bases, then asks about the branch with no base', async () => {
    expect(await resolveChain(WORKTREES)).toEqual(['feat', 'epic', 'develop']);
    expect(promptChainMissingBase).toHaveBeenCalledWith(
      'develop',
      expect.objectContaining({ allowRoot: true, detected: undefined }),
    );
  });

  it('offers the detected base and records the chosen base', async () => {
    vi.mocked(guessBranchBase).mockResolvedValue('main');
    vi.mocked(promptChainMissingBase)
      .mockResolvedValueOnce({ kind: 'base', base: 'main' })
      .mockResolvedValueOnce({ kind: 'root' });

    expect(await resolveChain(WORKTREES)).toEqual(['feat', 'epic', 'develop', 'main']);
    expect(promptChainMissingBase).toHaveBeenNthCalledWith(
      1,
      'develop',
      expect.objectContaining({ detected: 'main' }),
    );
    expect(setBranchBase).toHaveBeenCalledWith('develop', 'main');
  });

  it('does not offer the root option for the current branch', async () => {
    vi.mocked(getBranchBase).mockResolvedValue(undefined);
    vi.mocked(promptChainMissingBase).mockResolvedValueOnce({ kind: 'base', base: 'develop' });
    vi.mocked(promptChainMissingBase).mockResolvedValueOnce({ kind: 'root' });

    await resolveChain(WORKTREES);
    expect(promptChainMissingBase).toHaveBeenNthCalledWith(
      1,
      'feat',
      expect.objectContaining({ allowRoot: false }),
    );
  });

  it('prompts when the recorded base was deleted', async () => {
    vi.mocked(localBranchExists).mockImplementation(async (b) => b !== 'develop');
    expect(await resolveChain(WORKTREES)).toEqual(['feat', 'epic']);
    expect(promptChainMissingBase).toHaveBeenCalledWith('epic', expect.anything());
  });

  it('rejects a cycle', async () => {
    vi.mocked(getBranchBase).mockImplementation(async (b) => (b === 'feat' ? 'epic' : 'feat'));
    await expect(resolveChain(WORKTREES)).rejects.toThrow(/cycle/);
  });

  it('rejects picking a branch already in the chain', async () => {
    vi.mocked(promptChainMissingBase).mockResolvedValue({ kind: 'base', base: 'feat' });
    await expect(resolveChain(WORKTREES)).rejects.toThrow(/already in the chain/);
    expect(setBranchBase).not.toHaveBeenCalled();
  });
});

describe('planChain', () => {
  it('orders links root first and does not need a worktree for the root', () => {
    expect(planChain(['feat', 'epic', 'develop'], WORKTREES)).toEqual([
      { branch: 'develop', path: undefined },
      { branch: 'epic', path: '/wt/epic' },
      { branch: 'feat', path: '/wt/feat' },
    ]);
  });

  it('fails when a branch being merged into has no worktree', () => {
    expect(() => planChain(['feat', 'epic', 'develop'], [wt('feat', '/wt/feat')])).toThrow(
      /"epic" is not checked out/,
    );
  });
});

describe('mergeChain', () => {
  it('pulls and merges from the root down, in each child worktree', async () => {
    const order: string[] = [];
    vi.mocked(fastForwardBranch).mockImplementation(async (b) => void order.push(`ff ${b}`));
    vi.mocked(mergeBranch).mockImplementation(
      async (src, o) => (order.push(`merge ${src} @${o?.dir}`), ''),
    );

    await mergeChain({});

    expect(order).toEqual([
      'ff develop',
      'ff epic',
      'merge develop @/wt/epic',
      'merge epic @/wt/feat',
    ]);
  });

  it('skips pulling with --no-pull', async () => {
    await mergeChain({ pull: false });
    expect(fastForwardBranch).not.toHaveBeenCalled();
    expect(mergeBranch).toHaveBeenCalledTimes(2);
  });

  it('skips the pull for a branch with no remote', async () => {
    vi.mocked(remoteTrackingExists).mockImplementation(async (b) => b !== 'epic');
    await mergeChain({});
    expect(fastForwardBranch).toHaveBeenCalledOnce();
    expect(fastForwardBranch).toHaveBeenCalledWith('develop', undefined);
  });

  it('fails before merging anything when a pull fails', async () => {
    vi.mocked(fastForwardBranch).mockImplementation(async (b) => {
      if (b === 'epic') throw new Error('Not possible to fast-forward');
    });
    await expect(mergeChain({})).rejects.toThrow(/Could not pull "epic".*No branches were merged/s);
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('skips a link that already has everything', async () => {
    vi.mocked(countBehindAhead).mockImplementation(async (parent) =>
      parent === 'develop' ? [0, 3] : [1, 0],
    );
    await mergeChain({});
    expect(mergeBranch).toHaveBeenCalledTimes(1);
    expect(mergeBranch).toHaveBeenCalledWith('epic', { dir: '/wt/feat' });
    expect(logInfo).toHaveBeenCalledWith('"epic" already contains "develop".');
  });

  it('changes nothing when the user declines', async () => {
    vi.mocked(promptConfirm).mockResolvedValue(false);
    await mergeChain({});
    expect(fastForwardBranch).not.toHaveBeenCalled();
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('stashes a dirty worktree in place, with a recognizable message', async () => {
    vi.mocked(getWorktreeChanges).mockImplementation(async (p) =>
      p === '/wt/epic' ? [' M a.ts'] : [],
    );
    vi.mocked(promptUncommittedChangesForMerge).mockResolvedValue('add-and-stash');

    await mergeChain({});

    expect(stashCurrentChanges).toHaveBeenCalledWith({
      includeUntracked: true,
      dir: '/wt/epic',
      message: 'geet chain: epic',
    });
  });

  it('answers "merge anyway" for dirty worktrees with --force', async () => {
    vi.mocked(getWorktreeChanges).mockResolvedValue([' M a.ts']);
    await mergeChain({ force: true });
    expect(promptUncommittedChangesForMerge).not.toHaveBeenCalled();
    expect(stashCurrentChanges).not.toHaveBeenCalled();
  });

  it('names the worktree to resolve in when a merge conflicts', async () => {
    vi.mocked(mergeBranch).mockResolvedValueOnce('').mockRejectedValueOnce(new Error('CONFLICT'));
    await expect(mergeChain({})).rejects.toThrow(/"epic" into "feat" failed in \/wt\/feat/);
  });
});

describe('pullChain', () => {
  it('fast-forwards every base but the current branch, root first, without needing worktrees', async () => {
    vi.mocked(listWorktrees).mockResolvedValue([wt('feat', '/wt/feat')]);
    await pullChain({});
    expect(vi.mocked(fastForwardBranch).mock.calls).toEqual([
      ['develop', undefined],
      ['epic', undefined],
    ]);
    expect(mergeBranch).not.toHaveBeenCalled();
  });

  it('only checks bases for uncommitted changes, not the current branch', async () => {
    await pullChain({});
    expect(getWorktreeChanges).toHaveBeenCalledWith('/wt/epic');
    expect(getWorktreeChanges).not.toHaveBeenCalledWith('/wt/feat');
  });

  it('stops at the first branch that cannot be pulled', async () => {
    vi.mocked(fastForwardBranch).mockRejectedValueOnce(new Error('diverged'));
    await expect(pullChain({})).rejects.toThrow(/Could not pull "develop".*diverged/s);
    expect(fastForwardBranch).toHaveBeenCalledOnce();
  });

  it('changes nothing when the user declines', async () => {
    vi.mocked(promptConfirm).mockResolvedValue(false);
    await pullChain({});
    expect(fastForwardBranch).not.toHaveBeenCalled();
  });
});

describe('pushChain', () => {
  it('pushes every branch, root first, including the current one', async () => {
    vi.mocked(remoteTrackingExists).mockResolvedValue(false);
    await pushChain();
    expect(vi.mocked(pushBranch).mock.calls).toEqual([['develop'], ['epic'], ['feat']]);
  });

  it('skips branches that already match origin', async () => {
    vi.mocked(countBehindAhead).mockImplementation(async (base) =>
      base === 'origin/epic' ? [0, 0] : [0, 1],
    );
    await pushChain();
    expect(vi.mocked(pushBranch).mock.calls).toEqual([['develop'], ['feat']]);
  });

  it('stops when a push is rejected, naming the branch', async () => {
    vi.mocked(pushBranch).mockResolvedValueOnce().mockRejectedValueOnce(new Error('rejected'));
    await expect(pushChain()).rejects.toThrow(/Could not push "epic".*rejected/s);
    expect(pushBranch).toHaveBeenCalledTimes(2);
  });

  it('pushes nothing when the user declines', async () => {
    vi.mocked(promptConfirm).mockResolvedValue(false);
    await pushChain();
    expect(pushBranch).not.toHaveBeenCalled();
  });
});

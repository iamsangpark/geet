import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/git.ts', () => ({
  fastForwardBranch: vi.fn(),
  getBranchBase: vi.fn(),
  getCurrentBranch: vi.fn(),
  getWorktreeChanges: vi.fn(),
  guessBranchBase: vi.fn(),
  listAllLocalBranches: vi.fn(),
  listWorktrees: vi.fn(),
  localBranchExists: vi.fn(),
  setBranchBase: vi.fn(),
}));
vi.mock('../../../../src/prompts/common.ts', () => ({ logInfo: vi.fn() }));
vi.mock('../../../../src/prompts/worktree.ts', () => ({ promptSelectBaseBranch: vi.fn() }));

import { pullBase, resolveBase } from '../../../../src/commands/worktree/utils/baseBranch.ts';
import { promptSelectBaseBranch } from '../../../../src/prompts/worktree.ts';
import {
  fastForwardBranch,
  getBranchBase,
  getCurrentBranch,
  getWorktreeChanges,
  guessBranchBase,
  listAllLocalBranches,
  listWorktrees,
  localBranchExists,
  setBranchBase,
} from '../../../../src/utils/git.ts';

const wt = (branch: string, p: string) => ({ path: p, commit: 'abc', branch, isMain: false });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCurrentBranch).mockResolvedValue('feat');
  vi.mocked(localBranchExists).mockResolvedValue(true);
});

describe('resolveBase', () => {
  it('uses the recorded base', async () => {
    vi.mocked(getBranchBase).mockResolvedValue('develop');
    expect(await resolveBase()).toEqual({ current: 'feat', base: 'develop', source: 'recorded' });
    expect(setBranchBase).not.toHaveBeenCalled();
  });

  it('fails when the recorded base no longer exists', async () => {
    vi.mocked(getBranchBase).mockResolvedValue('gone');
    vi.mocked(localBranchExists).mockResolvedValue(false);
    await expect(resolveBase()).rejects.toThrow(/no longer exists/);
  });

  it('fails on a detached HEAD', async () => {
    vi.mocked(getCurrentBranch).mockResolvedValue('HEAD');
    await expect(resolveBase()).rejects.toThrow(/detached/);
  });

  it('falls back to the reflog guess and records it', async () => {
    vi.mocked(getBranchBase).mockResolvedValue(undefined);
    vi.mocked(guessBranchBase).mockResolvedValue('develop');
    expect(await resolveBase()).toEqual({ current: 'feat', base: 'develop', source: 'reflog' });
    expect(setBranchBase).toHaveBeenCalledWith('feat', 'develop');
  });

  it('ignores a reflog guess that no longer exists and prompts instead', async () => {
    vi.mocked(getBranchBase).mockResolvedValue(undefined);
    vi.mocked(guessBranchBase).mockResolvedValue('deleted');
    vi.mocked(localBranchExists).mockResolvedValue(false);
    vi.mocked(listAllLocalBranches).mockResolvedValue(['feat', 'main']);
    vi.mocked(promptSelectBaseBranch).mockResolvedValue('main');

    expect(await resolveBase()).toEqual({ current: 'feat', base: 'main', source: 'selected' });
    expect(promptSelectBaseBranch).toHaveBeenCalledWith(['main'], expect.any(String));
    expect(setBranchBase).toHaveBeenCalledWith('feat', 'main');
  });

  it('fails when there is no other branch to choose from', async () => {
    vi.mocked(getBranchBase).mockResolvedValue(undefined);
    vi.mocked(guessBranchBase).mockResolvedValue(undefined);
    vi.mocked(listAllLocalBranches).mockResolvedValue(['feat']);
    await expect(resolveBase()).rejects.toThrow(/no other local branch/i);
  });
});

describe('pullBase', () => {
  it('fast-forwards inside the worktree that has the base checked out', async () => {
    vi.mocked(listWorktrees).mockResolvedValue([wt('develop', '/wt/develop'), wt('feat', '/wt/f')]);
    vi.mocked(getWorktreeChanges).mockResolvedValue([]);
    await pullBase('develop');
    expect(fastForwardBranch).toHaveBeenCalledWith('develop', '/wt/develop');
  });

  it('updates the ref directly when the base is not in any worktree', async () => {
    vi.mocked(listWorktrees).mockResolvedValue([wt('feat', '/wt/f')]);
    await pullBase('develop');
    expect(getWorktreeChanges).not.toHaveBeenCalled();
    expect(fastForwardBranch).toHaveBeenCalledWith('develop', undefined);
  });

  it('refuses a dirty base worktree', async () => {
    vi.mocked(listWorktrees).mockResolvedValue([wt('develop', '/wt/develop')]);
    vi.mocked(getWorktreeChanges).mockResolvedValue([' M a.ts', '?? b.ts']);
    await expect(pullBase('develop')).rejects.toThrow(/2 uncommitted.*--force/s);
    expect(fastForwardBranch).not.toHaveBeenCalled();
  });

  it('pulls a dirty base worktree with force', async () => {
    vi.mocked(listWorktrees).mockResolvedValue([wt('develop', '/wt/develop')]);
    vi.mocked(getWorktreeChanges).mockResolvedValue([' M a.ts']);
    await pullBase('develop', { force: true });
    expect(fastForwardBranch).toHaveBeenCalledWith('develop', '/wt/develop');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/utils/git.ts', () => ({ listWorktrees: vi.fn() }));
vi.mock('../../../../src/prompts/common.ts', () => ({
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  logInfo: vi.fn(),
  outro: vi.fn(),
}));

import { loadWorktrees } from '../../../../src/commands/worktree/utils/loadWorktrees.ts';
import { logInfo, outro } from '../../../../src/prompts/common.ts';
import { listWorktrees } from '../../../../src/utils/git.ts';

const main = { path: '/repo', commit: 'a', branch: 'main', isMain: true };
const feat = { path: '/wt/feat', commit: 'b', branch: 'feat', isMain: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadWorktrees', () => {
  it('returns all worktrees and the filtered candidates', async () => {
    vi.mocked(listWorktrees).mockResolvedValueOnce([main, feat]);
    const loaded = await loadWorktrees({ filter: (w) => !w.isMain, emptyMessage: 'none' });
    expect(loaded).toEqual({ all: [main, feat], candidates: [feat] });
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('keeps everything when no filter is given', async () => {
    vi.mocked(listWorktrees).mockResolvedValueOnce([main, feat]);
    expect((await loadWorktrees({ emptyMessage: 'none' }))?.candidates).toEqual([main, feat]);
  });

  it('reports the empty message, closes the flow and returns null when nothing is left', async () => {
    vi.mocked(listWorktrees).mockResolvedValueOnce([main]);
    const loaded = await loadWorktrees({
      filter: (w) => !w.isMain,
      emptyMessage: 'No other worktrees found.',
    });
    expect(loaded).toBeNull();
    expect(logInfo).toHaveBeenCalledWith('No other worktrees found.');
    expect(outro).toHaveBeenCalledWith('Done.');
  });
});

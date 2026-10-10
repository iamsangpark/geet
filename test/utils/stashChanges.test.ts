import { beforeEach, describe, expect, it, vi } from 'vitest';

const spinnerMock = { start: vi.fn(), stop: vi.fn() };

vi.mock('../../src/utils/git.ts', () => ({ gitAddAll: vi.fn(), stashSave: vi.fn() }));
vi.mock('../../src/prompts/common.ts', () => ({ spinner: () => spinnerMock }));

import { gitAddAll, stashSave } from '../../src/utils/git.ts';
import { stashCurrentChanges } from '../../src/utils/stashChanges.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stashCurrentChanges', () => {
  it('stages everything before stashing when untracked files are included', async () => {
    const order: string[] = [];
    vi.mocked(gitAddAll).mockImplementation(async () => (order.push('add'), ''));
    vi.mocked(stashSave).mockImplementation(async () => (order.push('stash'), ''));

    await stashCurrentChanges({ includeUntracked: true });

    expect(order).toEqual(['add', 'stash']);
    expect(stashSave).toHaveBeenCalledWith();
    expect(spinnerMock.stop).toHaveBeenCalledWith('All changes staged and stashed.');
  });

  it('only stashes tracked changes otherwise', async () => {
    await stashCurrentChanges({ includeUntracked: false });

    expect(gitAddAll).not.toHaveBeenCalled();
    expect(stashSave).toHaveBeenCalledOnce();
    expect(spinnerMock.stop).toHaveBeenCalledWith('Current changes stashed.');
  });

  it('leaves the spinner running when git fails, so the error propagates', async () => {
    vi.mocked(stashSave).mockRejectedValueOnce(new Error('stash failed'));
    await expect(stashCurrentChanges({ includeUntracked: false })).rejects.toThrow('stash failed');
  });
});

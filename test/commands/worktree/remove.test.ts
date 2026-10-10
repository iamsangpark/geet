import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/git.ts', () => ({
  listWorktrees: vi.fn(),
  fetchPrune: vi.fn(),
  remoteTrackingExists: vi.fn(),
  getWorktreeChanges: vi.fn(),
  resetWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));
vi.mock('../../../src/prompts/common.ts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  promptConfirm: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock('../../../src/prompts/worktree.ts', () => ({
  promptMultiSelectWorktrees: vi.fn(),
  promptWorktreeChangesForRemove: vi.fn(),
}));
vi.mock('../../../src/commands/worktree/utils/openWorktree.ts', () => ({
  openHerdrWorkspaces: vi.fn(),
}));
vi.mock('../../../src/commands/worktree/utils/herdr.ts', () => ({
  closeHerdrWorkspace: vi.fn(),
  focusHerdrWorkspace: vi.fn(),
  listHerdrWorkspaces: vi.fn(),
  herdrMode: vi.fn(),
}));
vi.mock('../../../src/commands/worktree/utils/shell.ts', () => ({ spawnShellIn: vi.fn() }));

import {
  worktreePruneAction,
  worktreeRemoveAction,
} from '../../../src/commands/worktree/remove.ts';
import {
  closeHerdrWorkspace,
  focusHerdrWorkspace,
  herdrMode,
  listHerdrWorkspaces,
} from '../../../src/commands/worktree/utils/herdr.ts';
import { spawnShellIn } from '../../../src/commands/worktree/utils/shell.ts';
import { openHerdrWorkspaces } from '../../../src/commands/worktree/utils/openWorktree.ts';
import { logError, logInfo, logWarn, outro, promptConfirm } from '../../../src/prompts/common.ts';
import {
  promptMultiSelectWorktrees,
  promptWorktreeChangesForRemove,
} from '../../../src/prompts/worktree.ts';
import {
  fetchPrune,
  getWorktreeChanges,
  listWorktrees,
  remoteTrackingExists,
  removeWorktree,
  resetWorktree,
} from '../../../src/utils/git.ts';
import { GeetError } from '../../../src/utils/errors.ts';

const wt = (name: string, branch = name) => ({
  path: `/wt/${name}`,
  commit: 'abc',
  branch,
  isMain: false,
});
const main = { path: '/repo', commit: 'abc', branch: 'main', isMain: true };
const a = wt('a');
const b = wt('b');

/** Everything the user did and git did, in order — to assert "ask first, then act". */
let events: string[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  events = [];

  vi.mocked(listWorktrees).mockResolvedValue([main, a, b]);
  vi.mocked(getWorktreeChanges).mockResolvedValue([]);
  vi.mocked(openHerdrWorkspaces).mockResolvedValue(new Map());
  // By default the user selects every candidate offered
  vi.mocked(promptMultiSelectWorktrees).mockImplementation(async (_msg, candidates) => candidates);
  vi.mocked(promptConfirm).mockImplementation(async (msg) => {
    events.push(`confirm: ${msg}`);
    return true;
  });
  vi.mocked(promptWorktreeChangesForRemove).mockImplementation(async (branch) => {
    events.push(`changes prompt: ${branch}`);
    return 'reset';
  });
  vi.mocked(resetWorktree).mockImplementation(async (dir) => void events.push(`reset ${dir}`));
  vi.mocked(removeWorktree).mockImplementation(async (dir) => (events.push(`remove ${dir}`), ''));
  vi.mocked(closeHerdrWorkspace).mockImplementation(
    async (id) => void events.push(`close workspace ${id}`),
  );
});

describe('worktree remove', () => {
  it('stops early when only the main worktree exists', async () => {
    vi.mocked(listWorktrees).mockResolvedValue([main]);
    await worktreeRemoveAction();
    expect(logInfo).toHaveBeenCalledWith('No worktrees to remove.');
    expect(promptMultiSelectWorktrees).not.toHaveBeenCalled();
  });

  it('offers only non-main worktrees, none preselected', async () => {
    await worktreeRemoveAction();
    expect(promptMultiSelectWorktrees).toHaveBeenCalledWith('Select worktrees to remove', [a, b], {
      preselected: false,
    });
  });

  it('removes clean worktrees without resetting them', async () => {
    await worktreeRemoveAction();
    expect(resetWorktree).not.toHaveBeenCalled();
    expect(events).toEqual(['remove /wt/a', 'remove /wt/b']);
    expect(outro).toHaveBeenCalledWith('Removed 2 worktree(s).');
  });

  it('removes only what the user selected', async () => {
    vi.mocked(promptMultiSelectWorktrees).mockResolvedValue([b]);
    await worktreeRemoveAction();
    expect(events).toEqual(['remove /wt/b']);
  });

  it('resets a dirty worktree before removing it', async () => {
    vi.mocked(getWorktreeChanges).mockImplementation(async (dir) =>
      dir === '/wt/a' ? [' M file.ts'] : [],
    );
    await worktreeRemoveAction();
    expect(logWarn).toHaveBeenCalledWith('Uncommitted changes in /wt/a:\n M file.ts');
    expect(events).toEqual(['changes prompt: a', 'reset /wt/a', 'remove /wt/a', 'remove /wt/b']);
  });

  it('leaves a dirty worktree alone when the user skips it', async () => {
    vi.mocked(getWorktreeChanges).mockImplementation(async (dir) =>
      dir === '/wt/a' ? ['?? new.ts'] : [],
    );
    vi.mocked(promptWorktreeChangesForRemove).mockResolvedValue('skip');
    await worktreeRemoveAction();
    expect(events).toEqual(['remove /wt/b']);
    expect(outro).toHaveBeenCalledWith('Removed 1 worktree(s).');
  });

  it('reports "Nothing removed." when every worktree is skipped', async () => {
    vi.mocked(getWorktreeChanges).mockResolvedValue([' M x']);
    vi.mocked(promptWorktreeChangesForRemove).mockResolvedValue('skip');
    await worktreeRemoveAction();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(outro).toHaveBeenCalledWith('Nothing removed.');
  });

  it('asks every question before touching anything', async () => {
    vi.mocked(getWorktreeChanges).mockResolvedValue([' M x']);
    vi.mocked(openHerdrWorkspaces).mockResolvedValue(
      new Map([
        ['/wt/a', 'ws-a'],
        ['/wt/b', 'ws-b'],
      ]),
    );
    await worktreeRemoveAction();

    const firstDestructive = events.findIndex((e) => /^(reset|remove|close)/.test(e));
    const lastQuestion = events.findLastIndex((e) => /^(confirm|changes prompt)/.test(e));
    expect(lastQuestion).toBeGreaterThanOrEqual(0);
    expect(lastQuestion).toBeLessThan(firstDestructive);
  });

  describe('herdr workspaces', () => {
    it('asks once for a single open workspace and closes it after removal', async () => {
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(new Map([['/wt/a', 'ws-a']]));
      await worktreeRemoveAction();
      expect(promptConfirm).toHaveBeenCalledTimes(1);
      expect(promptConfirm).toHaveBeenCalledWith(
        'A herdr workspace is open for this worktree. Close it too?',
      );
      expect(events).toEqual([
        'confirm: A herdr workspace is open for this worktree. Close it too?',
        'remove /wt/a',
        'close workspace ws-a',
        'remove /wt/b',
      ]);
    });

    it('asks once with a count when several workspaces are open', async () => {
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(
        new Map([
          ['/wt/a', 'ws-a'],
          ['/wt/b', 'ws-b'],
        ]),
      );
      await worktreeRemoveAction();
      expect(promptConfirm).toHaveBeenCalledTimes(1);
      expect(promptConfirm).toHaveBeenCalledWith(
        '2 of these worktrees have an open herdr workspace. Close them too?',
      );
      expect(closeHerdrWorkspace).toHaveBeenCalledTimes(2);
    });

    it('keeps the workspaces open when the user declines', async () => {
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(new Map([['/wt/a', 'ws-a']]));
      vi.mocked(promptConfirm).mockResolvedValue(false);
      await worktreeRemoveAction();
      expect(closeHerdrWorkspace).not.toHaveBeenCalled();
      expect(removeWorktree).toHaveBeenCalledTimes(2);
    });

    it('never offers to close the workspace geet itself is running in', async () => {
      vi.stubEnv('HERDR_WORKSPACE_ID', 'ws-a');
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(new Map([['/wt/a', 'ws-a']]));
      await worktreeRemoveAction();
      expect(promptConfirm).not.toHaveBeenCalled();
      expect(closeHerdrWorkspace).not.toHaveBeenCalled();
    });

    it('does not ask when no workspace is open', async () => {
      await worktreeRemoveAction();
      expect(promptConfirm).not.toHaveBeenCalled();
    });

    it('only warns when closing a workspace fails', async () => {
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(new Map([['/wt/a', 'ws-a']]));
      vi.mocked(closeHerdrWorkspace).mockRejectedValue(new GeetError('herdr: nope'));
      await worktreeRemoveAction();
      expect(logWarn).toHaveBeenCalledWith('Could not close herdr workspace: herdr: nope');
      expect(outro).toHaveBeenCalledWith('Removed 2 worktree(s).');
    });
  });

  describe('failures', () => {
    it("one failure doesn't stop the rest, and is reported", async () => {
      vi.mocked(removeWorktree).mockImplementation(async (dir) => {
        if (dir === '/wt/a') throw new GeetError('contains modified files');
        events.push(`remove ${dir}`);
        return '';
      });
      await worktreeRemoveAction();

      expect(events).toEqual(['remove /wt/b']);
      expect(logInfo).toHaveBeenCalledWith('Removed 1 worktree(s).');
      expect(logError).toHaveBeenCalledWith('Failed to remove 1 worktree(s):');
      expect(logError).toHaveBeenCalledWith('  a (/wt/a): contains modified files');
      expect(outro).toHaveBeenCalledWith('geet wt remove completed with errors.');
    });

    it('does not claim any success when everything fails', async () => {
      vi.mocked(removeWorktree).mockRejectedValue(new GeetError('locked'));
      await worktreeRemoveAction();
      expect(logInfo).not.toHaveBeenCalledWith(expect.stringContaining('Removed'));
      expect(logError).toHaveBeenCalledWith('Failed to remove 2 worktree(s):');
    });

    it('skips closing the workspace of a worktree that failed to remove', async () => {
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(new Map([['/wt/a', 'ws-a']]));
      vi.mocked(removeWorktree).mockRejectedValue(new GeetError('locked'));
      await worktreeRemoveAction();
      expect(closeHerdrWorkspace).not.toHaveBeenCalled();
    });
  });
});

describe('removing the worktree geet is running in', () => {
  beforeEach(() => {
    vi.spyOn(process, 'cwd').mockReturnValue('/wt/a/src');
    vi.spyOn(process, 'chdir').mockImplementation((dir) => void events.push(`chdir ${dir}`));
    vi.mocked(promptMultiSelectWorktrees).mockImplementation(async () => [a, b]);
    vi.mocked(herdrMode).mockReturnValue('off');
    vi.mocked(focusHerdrWorkspace).mockImplementation(
      async (id) => void events.push(`focus workspace ${id}`),
    );
    vi.mocked(listHerdrWorkspaces).mockResolvedValue([]);
  });

  it('steps out, removes it last, then opens a shell in the base worktree outside herdr', async () => {
    await worktreeRemoveAction();
    expect(events).toEqual(['remove /wt/b', 'chdir /repo', 'remove /wt/a']);
    expect(spawnShellIn).toHaveBeenCalledWith('/repo');
  });

  it('does nothing special when removing a different worktree', async () => {
    vi.mocked(promptMultiSelectWorktrees).mockResolvedValue([b]);
    await worktreeRemoveAction();
    expect(process.chdir).not.toHaveBeenCalled();
    expect(spawnShellIn).not.toHaveBeenCalled();
  });

  it('does not leave when removal of the current worktree fails', async () => {
    vi.mocked(removeWorktree).mockRejectedValue(new GeetError('locked'));
    await worktreeRemoveAction();
    expect(spawnShellIn).not.toHaveBeenCalled();
  });

  describe('inside herdr', () => {
    beforeEach(() => {
      vi.mocked(herdrMode).mockReturnValue('auto');
      vi.stubEnv('HERDR_WORKSPACE_ID', 'ws-a');
      vi.mocked(closeHerdrWorkspace).mockImplementation(
        async (id) => void events.push(`close workspace ${id}`),
      );
    });

    it('switches to the base worktree workspace and closes the current one', async () => {
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(
        new Map([
          ['/repo', 'ws-main'],
          ['/wt/a', 'ws-a'],
        ]),
      );
      await worktreeRemoveAction();
      expect(events.slice(-3)).toEqual([
        'remove /wt/a',
        'focus workspace ws-main',
        'close workspace ws-a',
      ]);
      expect(spawnShellIn).not.toHaveBeenCalled();
    });

    it('falls back to the first other workspace when the base is not open', async () => {
      vi.mocked(openHerdrWorkspaces).mockResolvedValue(new Map([['/wt/a', 'ws-a']]));
      vi.mocked(listHerdrWorkspaces).mockResolvedValue(['ws-a', 'ws-x', 'ws-y']);
      await worktreeRemoveAction();
      expect(events.slice(-2)).toEqual(['focus workspace ws-x', 'close workspace ws-a']);
    });

    it('opens a shell in the base worktree when there are no other workspaces', async () => {
      vi.mocked(listHerdrWorkspaces).mockResolvedValue(['ws-a']);
      await worktreeRemoveAction();
      expect(focusHerdrWorkspace).not.toHaveBeenCalled();
      expect(closeHerdrWorkspace).not.toHaveBeenCalled();
      expect(spawnShellIn).toHaveBeenCalledWith('/repo');
    });

    it('opens a shell in the base worktree when herdr fails', async () => {
      vi.mocked(listHerdrWorkspaces).mockRejectedValue(new GeetError('herdr: down'));
      await worktreeRemoveAction();
      expect(spawnShellIn).toHaveBeenCalledWith('/repo');
    });
  });
});

describe('worktree prune', () => {
  it('fetches, then offers only worktrees whose remote branch is gone, all preselected', async () => {
    vi.mocked(listWorktrees).mockResolvedValue([main, a, b, wt('c', '(detached HEAD)')]);
    vi.mocked(remoteTrackingExists).mockImplementation(async (branch) => branch !== 'a');

    await worktreePruneAction();

    expect(fetchPrune).toHaveBeenCalledOnce();
    expect(remoteTrackingExists).not.toHaveBeenCalledWith('(detached HEAD)');
    expect(promptMultiSelectWorktrees).toHaveBeenCalledWith('Select worktrees to prune', [a], {
      preselected: true,
    });
    expect(events).toEqual(['remove /wt/a']);
    expect(outro).toHaveBeenCalledWith('Pruned 1 worktree(s).');
  });

  it('reports when nothing is stale', async () => {
    vi.mocked(remoteTrackingExists).mockResolvedValue(true);
    await worktreePruneAction();
    expect(logInfo).toHaveBeenCalledWith(
      'No stale worktrees found — all remote branches are still open.',
    );
    expect(promptMultiSelectWorktrees).not.toHaveBeenCalled();
  });

  it('uses the prune wording when it completes with errors', async () => {
    vi.mocked(remoteTrackingExists).mockResolvedValue(false);
    vi.mocked(removeWorktree).mockRejectedValue(new GeetError('locked'));
    await worktreePruneAction();
    expect(outro).toHaveBeenCalledWith('geet wt prune completed with errors.');
  });
});

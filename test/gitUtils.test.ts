import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import {
  addWorktree,
  branchExists,
  listStashes,
  listWorktrees,
  mergeBranch,
  parseGitError,
  stashSave,
} from '../src/gitUtils.ts';

const execaMock = vi.mocked(execa) as unknown as ReturnType<typeof vi.fn>;

/** Queue successive execa results; each entry becomes `{ stdout }` or `{ exitCode }`. */
function mockGit(...results: Array<string | { exitCode: number }>) {
  for (const r of results) {
    execaMock.mockResolvedValueOnce(typeof r === 'string' ? { stdout: r } : r);
  }
}

function gitArgs(call: number): string[] {
  return execaMock.mock.calls[call]![1] as string[];
}

beforeEach(() => {
  execaMock.mockReset();
});

describe('parseGitError', () => {
  it('strips ANSI codes and error/fatal/hint prefixes', () => {
    const err = parseGitError({
      stderr: '\x1b[31mfatal:\x1b[0m not a git repository\nhint: do something\n\n',
    });
    expect(err.gitMessage).toBe('not a git repository\ndo something');
    expect(err.message).toBe(err.gitMessage);
  });

  it('falls back to stdout, then message, then a default', () => {
    expect(parseGitError({ stdout: 'from stdout' }).gitMessage).toBe('from stdout');
    expect(parseGitError({ message: 'from message' }).gitMessage).toBe('from message');
    expect(parseGitError({}).gitMessage).toBe('Unknown git error');
  });
});

describe('git failures', () => {
  it('surface as cleaned errors with gitMessage', async () => {
    execaMock.mockRejectedValueOnce({ stderr: 'error: pathspec did not match' });
    await expect(mergeBranch('nope')).rejects.toMatchObject({
      gitMessage: 'pathspec did not match',
    });
  });
});

describe('branchExists', () => {
  it('reports local and remote independently', async () => {
    mockGit({ exitCode: 0 }, { exitCode: 2 });
    expect(await branchExists('feat')).toEqual({ local: true, remote: false });
  });
});

describe('addWorktree', () => {
  it('checks out an existing local branch', async () => {
    mockGit({ exitCode: 0 }, { exitCode: 0 }, '');
    await addWorktree('feat', '/tmp/wt');
    expect(gitArgs(2)).toEqual(['worktree', 'add', '/tmp/wt', 'feat']);
  });

  it('creates the branch with -b when it does not exist locally', async () => {
    mockGit({ exitCode: 1 }, { exitCode: 1 }, '');
    await addWorktree('feat', '/tmp/wt');
    expect(gitArgs(2)).toEqual(['worktree', 'add', '-b', 'feat', '/tmp/wt']);
  });
});

describe('listWorktrees', () => {
  it('parses porcelain output, marking the first entry as main', async () => {
    mockGit(
      [
        'worktree /repo\nHEAD aaa111\nbranch refs/heads/main',
        'worktree /repo-wt/feat\nHEAD bbb222\nbranch refs/heads/sp/feat',
        'worktree /repo-wt/detached\nHEAD ccc333\ndetached',
      ].join('\n\n') + '\n',
    );

    expect(await listWorktrees()).toEqual([
      { path: '/repo', commit: 'aaa111', branch: 'main', isMain: true },
      { path: '/repo-wt/feat', commit: 'bbb222', branch: 'sp/feat', isMain: false },
      { path: '/repo-wt/detached', commit: 'ccc333', branch: '(detached HEAD)', isMain: false },
    ]);
  });

  it('returns [] for empty output', async () => {
    mockGit('  \n');
    expect(await listWorktrees()).toEqual([]);
  });
});

describe('listStashes', () => {
  it('parses ref, name and date', async () => {
    mockGit(
      'stash@{0}|WIP on main: abc msg|2026-01-02 10:00:00 +0000\nstash@{1}|On feat: other|2026-01-01 09:00:00 +0000',
    );
    expect(await listStashes()).toEqual([
      {
        index: 0,
        ref: 'stash@{0}',
        name: 'WIP on main: abc msg',
        date: '2026-01-02 10:00:00 +0000',
      },
      { index: 1, ref: 'stash@{1}', name: 'On feat: other', date: '2026-01-01 09:00:00 +0000' },
    ]);
  });

  it('returns [] when there are no stashes', async () => {
    mockGit('');
    expect(await listStashes()).toEqual([]);
  });
});

describe('stashSave', () => {
  it('passes the message through when given', async () => {
    mockGit('');
    await stashSave('my msg');
    expect(gitArgs(0)).toEqual(['stash', 'push', '-m', 'my msg']);
  });

  it('uses a bare stash otherwise', async () => {
    mockGit('');
    await stashSave();
    expect(gitArgs(0)).toEqual(['stash']);
  });
});

describe('mergeBranch', () => {
  it('builds args for plain, ours and no-commit merges', async () => {
    mockGit('', '', '');
    await mergeBranch('feat');
    await mergeBranch('feat', { strategy: 'ours', noCommit: true });
    await mergeBranch('feat', { noCommit: true });
    expect(gitArgs(0)).toEqual(['merge', 'feat']);
    expect(gitArgs(1)).toEqual(['merge', '-X', 'ours', '--no-commit', 'feat']);
    expect(gitArgs(2)).toEqual(['merge', '--no-commit', 'feat']);
  });
});

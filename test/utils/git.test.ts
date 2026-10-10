import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { execa } from 'execa';
import {
  addWorktree,
  branchExists,
  checkoutBranch,
  checkoutForce,
  checkoutNewBranch,
  checkoutNewBranchInDir,
  deleteBranch,
  getCurrentBranch,
  getMainWorktree,
  getRepoName,
  getUncommittedChanges,
  getWorktreeChanges,
  listLocalBranches,
  listStashes,
  listWorktrees,
  mergeBranch,
  moveWorktree,
  parseGitError,
  pullBranch,
  remoteTrackingExists,
  resetWorktree,
  stashSave,
} from '../../src/utils/git.ts';

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

function gitOptions(call: number): { cwd?: string } {
  return execaMock.mock.calls[call]![2] as { cwd?: string };
}

const PORCELAIN = [
  'worktree /code/my-repo\nHEAD aaa111\nbranch refs/heads/main',
  'worktree /wt/my-repo/feat\nHEAD bbb222\nbranch refs/heads/feat',
].join('\n\n');

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

describe('status & branch', () => {
  it('getUncommittedChanges reads porcelain status', async () => {
    mockGit(' M a.ts');
    expect(await getUncommittedChanges()).toBe(' M a.ts');
    expect(gitArgs(0)).toEqual(['status', '--porcelain']);
  });

  it('getCurrentBranch reads the abbreviated HEAD', async () => {
    mockGit('feat');
    expect(await getCurrentBranch()).toBe('feat');
    expect(gitArgs(0)).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
  });
});

describe('checkout', () => {
  it.each([
    [checkoutBranch, ['checkout', 'feat']],
    [checkoutNewBranch, ['checkout', '-b', 'feat']],
    [checkoutForce, ['checkout', '--force', 'feat']],
  ])('builds the expected args', async (fn, expected) => {
    mockGit('');
    await fn('feat');
    expect(gitArgs(0)).toEqual(expected);
  });

  it('checkoutNewBranchInDir runs inside the given directory', async () => {
    mockGit('');
    await checkoutNewBranchInDir('feat', '/wt/feat');
    expect(gitArgs(0)).toEqual(['checkout', '-b', 'feat']);
    expect(gitOptions(0).cwd).toBe('/wt/feat');
  });
});

describe('remoteTrackingExists', () => {
  it.each([
    [0, true],
    [1, false],
  ])('exit code %i → %s, checking origin/<branch>', async (exitCode, expected) => {
    mockGit({ exitCode });
    expect(await remoteTrackingExists('feat')).toBe(expected);
    expect(gitArgs(0)).toEqual(['show-ref', '--verify', '--quiet', 'refs/remotes/origin/feat']);
  });
});

describe('worktree changes', () => {
  it('getWorktreeChanges lists individual files inside the worktree, dropping blanks', async () => {
    mockGit(' M a.ts\n?? dir/new.ts\n\n');
    expect(await getWorktreeChanges('/wt/feat')).toEqual([' M a.ts', '?? dir/new.ts']);
    expect(gitArgs(0)).toEqual(['status', '--porcelain', '--untracked-files=all']);
    expect(gitOptions(0).cwd).toBe('/wt/feat');
  });

  it('getWorktreeChanges returns [] for a clean worktree', async () => {
    mockGit('');
    expect(await getWorktreeChanges('/wt/feat')).toEqual([]);
  });

  it('resetWorktree hard-resets then cleans, both inside the worktree', async () => {
    mockGit('', '');
    await resetWorktree('/wt/feat');
    expect(gitArgs(0)).toEqual(['reset', '--hard']);
    expect(gitArgs(1)).toEqual(['clean', '-fd']);
    expect(gitOptions(0).cwd).toBe('/wt/feat');
    expect(gitOptions(1).cwd).toBe('/wt/feat');
  });
});

describe('worktree & branch management', () => {
  it('moveWorktree passes old and new paths', async () => {
    mockGit('');
    await moveWorktree('/wt/old', '/wt/new');
    expect(gitArgs(0)).toEqual(['worktree', 'move', '/wt/old', '/wt/new']);
  });

  it('deleteBranch uses -d, or -D when forced', async () => {
    mockGit('', '');
    await deleteBranch('old');
    await deleteBranch('old', true);
    expect(gitArgs(0)).toEqual(['branch', '-d', 'old']);
    expect(gitArgs(1)).toEqual(['branch', '-D', 'old']);
  });

  it('listLocalBranches excludes branches checked out in a worktree', async () => {
    mockGit('main\nfeat\n  spare  \n\nother\n', PORCELAIN);
    expect(await listLocalBranches()).toEqual(['spare', 'other']);
    expect(gitArgs(0)).toEqual(['branch', '--format=%(refname:short)']);
  });
});

describe('main worktree & repo name', () => {
  it('getMainWorktree returns the first worktree', async () => {
    mockGit(PORCELAIN);
    expect(await getMainWorktree()).toMatchObject({ path: '/code/my-repo', isMain: true });
  });

  it('getRepoName is the main worktree folder name, not the current one', async () => {
    mockGit(PORCELAIN);
    expect(await getRepoName()).toBe('my-repo');
  });

  it('getRepoName throws when git lists no worktrees', async () => {
    mockGit('');
    await expect(getRepoName()).rejects.toMatchObject({
      gitMessage: 'Could not find main worktree.',
    });
  });
});

describe('pullBranch', () => {
  it('fast-forwards another branch via fetch origin <b>:<b> without switching', async () => {
    mockGit('', 'main', '');
    await pullBranch('feat');
    expect(gitArgs(0)).toEqual(['fetch', '--all']);
    expect(gitArgs(1)).toEqual(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(gitArgs(2)).toEqual(['fetch', 'origin', 'feat:feat']);
  });

  it('merges origin/<branch> when it is the current branch', async () => {
    mockGit('', 'feat', '');
    await pullBranch('feat');
    expect(gitArgs(2)).toEqual(['merge', 'origin/feat']);
  });
});

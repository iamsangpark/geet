import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('execa', () => ({ execa: vi.fn() }));
vi.mock('../../../../src/config.ts', () => ({ HERDR_MODE: 'auto' }));

import { execa } from 'execa';
import {
  closeHerdrWorkspace,
  herdrMode,
  listHerdrWorktrees,
  openHerdrWorktree,
} from '../../../../src/commands/worktree/utils/herdr.ts';

const execaMock = vi.mocked(execa) as unknown as ReturnType<typeof vi.fn>;

/** Queue a herdr response; JSON goes to stdout (success) or stderr (error). */
function herdrOutput(out: { stdout?: string; stderr?: string }) {
  execaMock.mockResolvedValueOnce({ stdout: '', stderr: '', ...out });
}

function herdrArgs(call = 0): string[] {
  return execaMock.mock.calls[call]![1] as string[];
}

beforeEach(() => {
  execaMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('herdrMode', () => {
  it("is 'off' outside a herdr pane regardless of GEET_HERDR", () => {
    vi.stubEnv('HERDR_ENV', '');
    expect(herdrMode()).toBe('off');
  });

  it('is the configured mode inside a herdr pane', () => {
    vi.stubEnv('HERDR_ENV', '1');
    expect(herdrMode()).toBe('auto');
  });
});

describe('listHerdrWorktrees', () => {
  it('passes the repo as --cwd and returns the worktrees', async () => {
    const worktrees = [{ path: '/wt/a', branch: 'a', open_workspace_id: 'w1' }];
    herdrOutput({ stdout: JSON.stringify({ result: { worktrees } }) });
    expect(await listHerdrWorktrees('/repo')).toEqual(worktrees);
    expect(herdrArgs()).toEqual(['worktree', 'list', '--cwd', '/repo']);
  });

  it('returns [] when the result has no worktrees', async () => {
    herdrOutput({ stdout: '{}' });
    expect(await listHerdrWorktrees('/repo')).toEqual([]);
  });
});

describe('openHerdrWorktree', () => {
  const opts = { repoPath: '/repo', dir: '/wt/a', label: 'a' };

  it('opens and focuses the worktree, reporting the workspace', async () => {
    herdrOutput({
      stdout: JSON.stringify({ result: { workspace: { workspace_id: 'w9' }, already_open: true } }),
    });
    expect(await openHerdrWorktree(opts)).toEqual({ workspaceId: 'w9', alreadyOpen: true });
    expect(herdrArgs()).toEqual([
      'worktree',
      'open',
      '--cwd',
      '/repo',
      '--path',
      '/wt/a',
      '--label',
      'a',
      '--focus',
    ]);
  });

  it('treats a missing already_open as false', async () => {
    herdrOutput({ stdout: JSON.stringify({ result: { workspace: { workspace_id: 'w9' } } }) });
    expect((await openHerdrWorktree(opts)).alreadyOpen).toBe(false);
  });

  it('rejects a response without a workspace', async () => {
    herdrOutput({ stdout: '{"result":{}}' });
    await expect(openHerdrWorktree(opts)).rejects.toMatchObject({
      gitMessage: 'herdr: response did not include a workspace',
    });
  });
});

describe('closeHerdrWorkspace', () => {
  it('closes by id', async () => {
    herdrOutput({ stdout: '{}' });
    await closeHerdrWorkspace('w1');
    expect(herdrArgs()).toEqual(['workspace', 'close', 'w1']);
  });
});

describe('herdr failures', () => {
  it('surface a JSON error from stderr, preferring message over code', async () => {
    herdrOutput({
      stderr: JSON.stringify({ error: { message: 'no such workspace', code: 'E1' } }),
    });
    await expect(closeHerdrWorkspace('w1')).rejects.toMatchObject({
      gitMessage: 'herdr: no such workspace',
    });
  });

  it('fall back to the error code, then a generic message', async () => {
    herdrOutput({ stderr: '{"error":{"code":"E1"}}' });
    await expect(closeHerdrWorkspace('w1')).rejects.toMatchObject({ gitMessage: 'herdr: E1' });
    herdrOutput({ stderr: '{"error":{}}' });
    await expect(closeHerdrWorkspace('w1')).rejects.toMatchObject({
      gitMessage: 'herdr: unknown error',
    });
  });

  it('report unparseable output verbatim', async () => {
    herdrOutput({ stderr: ' boom \n' });
    await expect(closeHerdrWorkspace('w1')).rejects.toMatchObject({ gitMessage: 'herdr: boom' });
  });

  it('report an empty response', async () => {
    herdrOutput({});
    await expect(closeHerdrWorkspace('w1')).rejects.toMatchObject({
      gitMessage: 'herdr: empty or unparseable response',
    });
  });

  it('report a missing binary', async () => {
    execaMock.mockRejectedValueOnce(Object.assign(new Error('spawn herdr'), { code: 'ENOENT' }));
    await expect(closeHerdrWorkspace('w1')).rejects.toMatchObject({
      gitMessage: 'herdr: binary not found in PATH',
    });
  });
});

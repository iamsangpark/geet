import { lstat, mkdir, mkdtemp, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/prompts/common.ts', () => ({
  logWarn: vi.fn(),
  logError: vi.fn(),
  logSuccess: vi.fn(),
}));

import { linkPaths } from '../../../../src/commands/worktree/utils/symlinks.ts';
import { logWarn } from '../../../../src/prompts/common.ts';

let root: string;
let source: string;
let target: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'geet-symlinks-'));
  source = path.join(root, 'main');
  target = path.join(root, 'wt');
  await mkdir(path.join(source, 'nested'), { recursive: true });
  await mkdir(target);
  await writeFile(path.join(source, '.env.local'), 'A=1\n');
  await writeFile(path.join(source, 'nested', 'file'), 'x');
  vi.mocked(logWarn).mockClear();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('linkPaths', () => {
  it('links files, creating parent directories', async () => {
    await linkPaths(source, target, ['.env.local', 'nested/file']);
    expect(await readlink(path.join(target, '.env.local'))).toBe(path.join(source, '.env.local'));
    expect(await readlink(path.join(target, 'nested', 'file'))).toBe(
      path.join(source, 'nested', 'file'),
    );
  });

  it('skips sources that do not exist', async () => {
    await linkPaths(source, target, ['missing']);
    await expect(lstat(path.join(target, 'missing'))).rejects.toThrow();
    expect(logWarn).toHaveBeenCalledWith('Skipped (source does not exist): missing');
  });

  it('leaves existing destinations alone by default', async () => {
    await writeFile(path.join(target, '.env.local'), 'mine');
    await linkPaths(source, target, ['.env.local']);
    expect((await lstat(path.join(target, '.env.local'))).isSymbolicLink()).toBe(false);
    expect(logWarn).toHaveBeenCalledWith('Skipped (already exists): .env.local');
  });

  it('replaces existing destinations when replace is set', async () => {
    await symlink('/nowhere', path.join(target, '.env.local'));
    await linkPaths(source, target, ['.env.local'], { replace: true });
    expect(await readlink(path.join(target, '.env.local'))).toBe(path.join(source, '.env.local'));
  });
});

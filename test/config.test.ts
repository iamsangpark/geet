import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readEnvFile, writeEnvValues } from '../src/config.ts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'geet-config-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readEnvFile', () => {
  it('parses dotenv-style content', async () => {
    const file = path.join(dir, '.env');
    await writeFile(file, 'GEET_BRANCH_PREFIX=sp/\n# comment\nGEET_SYMLINK_PATHS=a,b\n');
    expect(await readEnvFile(file)).toEqual({
      GEET_BRANCH_PREFIX: 'sp/',
      GEET_SYMLINK_PATHS: 'a,b',
    });
  });

  it('returns {} when the file does not exist', async () => {
    expect(await readEnvFile(path.join(dir, 'missing'))).toEqual({});
  });
});

describe('writeEnvValues', () => {
  it('creates the file and parent directories', async () => {
    const file = path.join(dir, 'nested', 'config');
    await writeEnvValues(file, { GEET_BRANCH_PREFIX: 'sp/' });
    expect(await readFile(file, 'utf8')).toBe('GEET_BRANCH_PREFIX=sp/\n');
  });

  it('updates existing keys in place and preserves comments and unrelated lines', async () => {
    const file = path.join(dir, '.env');
    await writeFile(file, '# my config\nOTHER=1\nGEET_BRANCH_PREFIX=old/\n');
    await writeEnvValues(file, { GEET_BRANCH_PREFIX: 'new/' });
    expect(await readFile(file, 'utf8')).toBe('# my config\nOTHER=1\nGEET_BRANCH_PREFIX=new/\n');
  });

  it('appends keys that are not present', async () => {
    const file = path.join(dir, '.env');
    await writeFile(file, 'OTHER=1\n');
    await writeEnvValues(file, { GEET_HERDR: 'auto' });
    expect(await readFile(file, 'utf8')).toBe('OTHER=1\nGEET_HERDR=auto\n');
  });

  it('skips empty values and leaves existing entries for them untouched', async () => {
    const file = path.join(dir, '.env');
    await writeFile(file, 'GEET_BRANCH_PREFIX=keep/\n');
    await writeEnvValues(file, { GEET_BRANCH_PREFIX: '', GEET_HERDR: '' });
    expect(await readFile(file, 'utf8')).toBe('GEET_BRANCH_PREFIX=keep/\n');
  });
});

describe('env-derived constants', () => {
  // config.ts reads process.env at import time, so re-import it per case.
  // HOME points at an empty dir so a real ~/.geet/config cannot leak in.
  async function loadConfig(env: Record<string, string>) {
    vi.resetModules();
    vi.stubEnv('HOME', dir);
    for (const key of [
      'GEET_WORKTREE_BASE',
      'GEET_BRANCH_PREFIX',
      'GEET_SYMLINK_PATHS',
      'GEET_HERDR',
    ]) {
      vi.stubEnv(key, env[key] ?? '');
    }
    return import('../src/config.ts');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses SYMLINK_PATHS, trimming entries and dropping blanks', async () => {
    const cfg = await loadConfig({ GEET_SYMLINK_PATHS: ' .env.local, node_modules ,, .idea' });
    expect(cfg.SYMLINK_PATHS).toEqual(['.env.local', 'node_modules', '.idea']);
  });

  it('defaults SYMLINK_PATHS to []', async () => {
    expect((await loadConfig({})).SYMLINK_PATHS).toEqual([]);
  });

  it.each([
    ['prompt', 'prompt'],
    [' AUTO ', 'auto'],
    ['off', 'off'],
    ['bogus', 'off'],
    ['', 'off'],
  ])('HERDR_MODE %j → %s', async (raw, expected) => {
    expect((await loadConfig({ GEET_HERDR: raw })).HERDR_MODE).toBe(expected);
  });

  it('expands ~ in WORKTREE_BASE', async () => {
    const cfg = await loadConfig({ GEET_WORKTREE_BASE: '~/dev/worktrees' });
    expect(cfg.WORKTREE_BASE).toBe(path.join(os.homedir(), 'dev/worktrees'));
  });
});

describe('project map', () => {
  // GLOBAL_PROJECT_MAP_PATH is derived from the home dir at import time.
  async function loadConfig() {
    vi.resetModules();
    vi.stubEnv('HOME', dir);
    return import('../src/config.ts');
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads {} when the map file does not exist', async () => {
    expect(await (await loadConfig()).readProjectMap()).toEqual({});
  });

  it('round-trips through writeProjectMap, creating ~/.geet', async () => {
    const cfg = await loadConfig();
    await cfg.writeProjectMap({ 'my-repo': 'my-project' });
    expect(cfg.GLOBAL_PROJECT_MAP_PATH).toBe(path.join(dir, '.geet', 'project-map.json'));
    expect(await readFile(cfg.GLOBAL_PROJECT_MAP_PATH, 'utf8')).toBe(
      '{\n  "my-repo": "my-project"\n}\n',
    );
    expect(await cfg.readProjectMap()).toEqual({ 'my-repo': 'my-project' });
  });

  it('throws on malformed JSON rather than silently returning {}', async () => {
    const cfg = await loadConfig();
    await mkdir(path.dirname(cfg.GLOBAL_PROJECT_MAP_PATH), { recursive: true });
    await writeFile(cfg.GLOBAL_PROJECT_MAP_PATH, '{ not json');
    await expect(cfg.readProjectMap()).rejects.toThrow();
  });
});

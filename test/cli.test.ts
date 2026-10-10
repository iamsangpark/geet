import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

/** Runs the real CLI entry point (via Node type stripping) with the given args. */
async function geet(...args: string[]) {
  const { stdout } = await run('node', ['src/index.ts', ...args], { env: { ...process.env } });
  return stdout.trim();
}

/** Asks omelette for completions the way the bash hook does. */
async function complete(line: string) {
  const words = line.split(' ');
  const cword = words.length - 1;
  const out = await geet('--compbash', '--compgen', String(cword), words[cword - 1]!, line);
  return out.split('\n').filter(Boolean);
}

describe('geet CLI', () => {
  it('prints the version from package.json', async () => {
    const { version } = JSON.parse(await readFile('package.json', 'utf8'));
    expect(await geet('--version')).toBe(version);
  });

  it('completes top-level commands including aliases', async () => {
    const commands = await complete('geet ');
    expect(commands).toEqual(
      expect.arrayContaining(['checkout', 'co', 'stash', 'sts', 'worktree', 'wt', 'config', 'cfg']),
    );
    expect(commands).toEqual(expect.arrayContaining(['copy', 'cp', 'merge-release']));
  });

  it.each(['worktree', 'wt'])('completes worktree subcommands after "%s"', async (name) => {
    expect(await complete(`geet ${name} `)).toEqual([
      'new',
      'add',
      'list',
      'remove',
      'prune',
      'rename',
      'link-fix',
      'pull',
      'merge',
    ]);
  });

  it('completes subcommands for the other command groups', async () => {
    expect(await complete('geet config ')).toEqual([
      'list',
      'global',
      'local',
      'set',
      'init-script',
      'project-map',
    ]);
    expect(await complete('geet sts ')).toEqual(['pop', 'list']);
    expect(await complete('geet copy ')).toEqual(['path', 'worktree', 'jira', 'branch']);
  });

  it('completes nothing for commands without subcommands', async () => {
    expect(await complete('geet checkout ')).toEqual([]);
  });

  it('lists subcommands in the group help text', async () => {
    // commander wraps help text to the terminal width
    const help = (await geet('worktree', '--help')).replace(/\s+/g, ' ');
    expect(help).toContain(
      '(subcommands: new, add, list, remove, prune, rename, link-fix, pull, merge)',
    );
  });
});

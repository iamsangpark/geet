import path from 'path';
import os from 'os';
import { createInterface } from 'readline';
import { access } from 'fs/promises';
import { constants } from 'fs';
import { execa } from 'execa';
import { errorMessage } from '../../../utils/errors.ts';
import { logInfo, logError, logSuccess } from '../../../prompts/common.ts';

/**
 * Runs a single init script if it exists and is executable.
 * Streams output into a rolling 4-line window using ANSI cursor control.
 */
async function runScript(scriptPath: string, newWorktreeDir: string) {
  logInfo(`Running init script: ${scriptPath}`);

  const TAIL = 4;
  const lines: string[] = [];
  let windowDrawn = false;

  const drawWindow = () => {
    const cols = process.stdout.columns || 80;
    const maxWidth = cols - 6;
    const tail = lines.slice(-TAIL);

    if (windowDrawn) {
      process.stdout.write(`\x1b[${TAIL}A\x1b[0J`);
    }

    for (let i = 0; i < TAIL; i++) {
      const raw = tail[i] ?? '';
      const display = raw.length > maxWidth ? `${raw.slice(0, maxWidth - 3)}...` : raw;
      process.stdout.write(`  \x1b[2m│\x1b[0m ${display}\n`);
    }

    windowDrawn = true;
  };

  drawWindow();

  try {
    const proc = execa(scriptPath, [], { cwd: newWorktreeDir, all: true });
    if (!proc.all) throw new Error('script output stream unavailable');
    const rl = createInterface({ input: proc.all, crlfDelay: Infinity });

    rl.on('line', (line) => {
      lines.push(line);
      drawWindow();
    });

    await Promise.all([proc, new Promise<void>((resolve) => rl.once('close', resolve))]);

    logSuccess('Init script completed.');
  } catch (err) {
    logError(`Init script failed: ${errorMessage(err)}`);
  }
}

/**
 * Init scripts that apply to a repo, in run order: ~/.geet/init/default.sh then
 * ~/.geet/init/<repo-name>.sh. Scripts that are missing or not executable are left out.
 */
export async function findInitScripts(mainWorktreePath: string): Promise<string[]> {
  const initDir = path.join(os.homedir(), '.geet', 'init');
  const repoName = path.basename(mainWorktreePath);
  const found: string[] = [];
  for (const script of [path.join(initDir, 'default.sh'), path.join(initDir, `${repoName}.sh`)]) {
    try {
      await access(script, constants.X_OK);
      found.push(script);
    } catch {
      // doesn't exist or isn't executable — skip silently
    }
  }
  return found;
}

/** Runs the given init scripts in order, in the worktree directory, in this terminal. */
export async function runInitScripts(scripts: string[], newWorktreeDir: string) {
  for (const script of scripts) {
    await runScript(script, newWorktreeDir);
  }
}

/** One shell command line that runs the scripts in order, for typing into another terminal. */
export function initScriptsCommand(scripts: string[]): string {
  return scripts.map((s) => `'${s.replace(/'/g, `'\\''`)}'`).join('; ');
}

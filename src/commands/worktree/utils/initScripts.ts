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
  try {
    await access(scriptPath, constants.X_OK);
  } catch {
    return; // script doesn't exist or isn't executable — skip silently
  }

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
 * Runs ~/.geet/init/default.sh (if present) then ~/.geet/init/<repo-name>.sh
 * (if present) in the newly created worktree directory.
 */
export async function runInitScript(mainWorktreePath: string, newWorktreeDir: string) {
  const initDir = path.join(os.homedir(), '.geet', 'init');
  await runScript(path.join(initDir, 'default.sh'), newWorktreeDir);

  const repoName = path.basename(mainWorktreePath);
  await runScript(path.join(initDir, `${repoName}.sh`), newWorktreeDir);
}

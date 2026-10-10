import { spawn } from 'child_process';
import { errorMessage } from '../../../utils/errors.ts';
import { logError } from '../../../prompts.ts';

/**
 * Spawns an interactive shell session in the given directory.
 */
export function spawnShellIn(dir: string): void {
  const shell = process.env.SHELL || '/bin/zsh';
  const child = spawn(shell, [], {
    cwd: dir,
    stdio: 'inherit',
    detached: false,
  });

  child.on('error', (err) => {
    logError(`Failed to spawn shell: ${errorMessage(err)}`);
    process.exit(1);
  });

  child.on('close', (code) => {
    process.exit(code ?? 0);
  });
}

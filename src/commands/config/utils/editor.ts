import { spawn } from 'child_process';
import { logInfo, logWarn } from '../../../prompts/common.ts';

/**
 * Opens the given file in the user's $EDITOR (falls back to vi).
 * Waits for the editor to exit before continuing.
 */
export function openInEditor(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const editorEnv = process.env.EDITOR || 'vi';
    const [editor = 'vi', ...editorArgs] = editorEnv.split(/\s+/);
    logInfo(`Opening in $EDITOR (${editorEnv})...`);

    const child = spawn(editor, [...editorArgs, filePath], {
      stdio: 'inherit',
      detached: false,
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to open editor "${editor}": ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        logWarn(`Editor exited with code ${code}.`);
      }
      resolve();
    });
  });
}

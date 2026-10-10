/**
 * commands/config/initScript.ts
 * Implements:
 *   geet config init-script            — scaffold the worktree init script for this repo
 *   geet config init-script --default  — scaffold ~/.geet/init/default.sh (runs for all repos)
 */

import path from 'path';
import os from 'os';
import { access, copyFile, rename, chmod, mkdir, writeFile, unlink } from 'fs/promises';
import { constants } from 'fs';
import { GeetError, errorCode, errorMessage } from '../../utils/errors.ts';
import { getRepoName } from '../../utils/git.ts';
import { intro, outro, logInfo, logSuccess, spinner } from '../../prompts/common.ts';
import {
  promptInitScriptSource,
  promptOverrideOrSkip,
  promptCopyOrMove,
} from '../../prompts/config.ts';
import { openInEditor } from './utils/editor.ts';
import { REPO_STUB_CONTENT, DEFAULT_STUB_CONTENT } from './utils/stubs.ts';

const INIT_DIR = path.join(os.homedir(), '.geet', 'init');

/**
 * Shared scaffolding logic for init scripts.
 * Creates, copies, or edits the script at targetPath using stubContent as the
 * template when no source file is provided.
 */
async function scaffoldInitScript(targetPath: string, stubContent: string) {
  logInfo(`Target: ${targetPath}`);

  let exists = false;
  try {
    await access(targetPath, constants.F_OK);
    exists = true;
  } catch {
    // doesn't exist — proceed
  }

  if (exists) {
    const action = await promptOverrideOrSkip();
    if (action === 'skip') {
      outro('Skipped — existing script left unchanged.');
      return;
    }
    if (action === 'edit') {
      await openInEditor(targetPath);
      outro(`Init script ready: ${targetPath}`);
      return;
    }
  }

  await mkdir(INIT_DIR, { recursive: true });

  const srcInput = await promptInitScriptSource();
  const srcPath = srcInput?.trim() ?? '';

  if (srcPath) {
    try {
      await access(srcPath, constants.F_OK);
    } catch {
      throw new GeetError(`Source file not found: ${srcPath}`);
    }

    const operation = await promptCopyOrMove();

    const s2 = spinner();
    s2.start(`${operation === 'copy' ? 'Copying' : 'Moving'} ${srcPath} → ${targetPath}...`);
    if (operation === 'copy') {
      await copyFile(srcPath, targetPath);
    } else {
      try {
        await rename(srcPath, targetPath);
      } catch (renameErr) {
        if (errorCode(renameErr) === 'EXDEV') {
          await copyFile(srcPath, targetPath);
          await unlink(srcPath);
        } else {
          throw renameErr;
        }
      }
    }
    s2.stop('Done.');
    logSuccess(`Script ${operation === 'copy' ? 'copied' : 'moved'} to ${targetPath}`);
  } else {
    const s2 = spinner();
    s2.start('Writing stub script...');
    await writeFile(targetPath, stubContent, 'utf8');
    s2.stop('Stub written.');
    logSuccess(`Stub created at ${targetPath}`);
  }

  await chmod(targetPath, 0o755);
  logInfo('Script marked executable (chmod +x).');

  await openInEditor(targetPath);

  outro(`Init script ready: ${targetPath}`);
}

/**
 * Scaffold (or replace) the worktree init script for the current repo,
 * or the default init script when --default/-d is passed.
 */
export async function configInitScriptAction(options: { default?: boolean }) {
  if (options.default) {
    intro('geet config init-script --default');
    await scaffoldInitScript(path.join(INIT_DIR, 'default.sh'), DEFAULT_STUB_CONTENT);
    return;
  }

  intro('geet config init-script');

  const s = spinner();
  s.start('Detecting repo name from worktrees...');
  let repoName: string;
  try {
    repoName = await getRepoName();
  } catch (err) {
    s.stop('');
    throw new GeetError(`Failed to detect repo name: ${errorMessage(err)}`);
  }
  s.stop(`Repo: ${repoName}`);

  await scaffoldInitScript(path.join(INIT_DIR, `${repoName}.sh`), REPO_STUB_CONTENT);
}

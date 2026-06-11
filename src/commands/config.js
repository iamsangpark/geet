/**
 * commands/config.js
 * Implements:
 *   geet config global               — interactively create/update ~/.geet/config
 *   geet config local                — create/update .env or .env.local in the cwd
 *   geet config set                  — update a single key in a chosen file
 *   geet config init-script          — scaffold the worktree init script for this repo
 *   geet config init-script --default — scaffold ~/.geet/init/default.sh (runs for all repos)
 */

import path from 'path';
import os from 'os';
import { access, copyFile, rename, chmod, mkdir, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { spawn } from 'child_process';
import { GLOBAL_CONFIG_PATH, CONFIG_KEYS, readEnvFile, writeEnvValues } from '../config.js';
import { listWorktrees } from '../gitUtils.js';
import {
  intro,
  outro,
  logInfo,
  logWarn,
  logSuccess,
  spinner,
  promptConfigValues,
  promptSelectConfigFile,
  promptSelectLocalFile,
  promptSelectConfigKey,
  promptInitScriptSource,
  promptOverrideOrSkip,
  promptCopyOrMove,
  guardCancel,
} from '../prompts.js';
import * as p from '@clack/prompts';

// ── config global ─────────────────────────────────────────────────────────────

/**
 * Interactively create or update ~/.geet/config.
 * Existing values are pre-filled so users only need to change what they want.
 */
export async function configGlobalAction() {
  intro('geet config global');

  const s = spinner();
  s.start('Reading current global config...');
  const current = await readEnvFile(GLOBAL_CONFIG_PATH);
  s.stop('Current config loaded.');

  if (Object.keys(current).length > 0) {
    logInfo('Existing values are pre-filled — press Enter to keep, or type a new value.');
  }

  const values = await promptConfigValues(current);

  if (Object.keys(values).length === 0) {
    logWarn('No values entered — nothing written.');
    outro('Done.');
    return;
  }

  const s2 = spinner();
  s2.start(`Writing to ${GLOBAL_CONFIG_PATH}...`);
  await writeEnvValues(GLOBAL_CONFIG_PATH, values);
  s2.stop('Global config updated.');

  outro(`Saved: ${GLOBAL_CONFIG_PATH}`);
}

// ── config local ──────────────────────────────────────────────────────────────

/**
 * Create or update .env or .env.local in the current working directory.
 */
export async function configLocalAction() {
  intro('geet config local');

  const filePath = await promptSelectLocalFile();

  const s = spinner();
  s.start(`Reading ${path.basename(filePath)}...`);
  const current = await readEnvFile(filePath);
  s.stop('Current values loaded.');

  if (Object.keys(current).length > 0) {
    logInfo('Existing values are pre-filled — press Enter to keep, or type a new value.');
  }

  const values = await promptConfigValues(current);

  if (Object.keys(values).length === 0) {
    logWarn('No values entered — nothing written.');
    outro('Done.');
    return;
  }

  const s2 = spinner();
  s2.start(`Writing to ${filePath}...`);
  await writeEnvValues(filePath, values);
  s2.stop('Config written.');

  outro(`Saved: ${filePath}`);
}

// ── config set ────────────────────────────────────────────────────────────────

/**
 * Update a single config key in a file of the user's choosing.
 */
export async function configSetAction() {
  intro('geet config set');

  const filePath = await promptSelectConfigFile();

  const s = spinner();
  s.start(`Reading ${path.basename(filePath)}...`);
  const current = await readEnvFile(filePath);
  s.stop('File read.');

  const key = await promptSelectConfigKey(current);

  const meta = CONFIG_KEYS.find((k) => k.key === key);
  const newValue = await p.text({
    message: `New value for ${meta.label}:`,
    placeholder: meta.placeholder,
    hint: meta.hint,
    initialValue: current[key] ?? '',
  });
  guardCancel(newValue);

  if (!newValue.trim()) {
    logWarn('Empty value — nothing written.');
    outro('Done.');
    return;
  }

  const s2 = spinner();
  s2.start(`Updating ${key} in ${path.basename(filePath)}...`);
  await writeEnvValues(filePath, { [key]: newValue.trim() });
  s2.stop('Value updated.');

  outro(`${key}=${newValue.trim()} → ${filePath}`);
}

// ── config init-script ────────────────────────────────────────────────────────

const REPO_STUB_CONTENT = `#!/usr/bin/env bash
set -euo pipefail

# Runs in the new worktree directory after \`geet worktree add\` / \`geet wt smart-add\`.
# The current directory is the newly-created worktree.
#
# Examples:
#   npm install
#   cp ../.env.local .env.local
`;

const DEFAULT_STUB_CONTENT = `#!/usr/bin/env bash
set -euo pipefail

# Default init script — runs for every repo before any repo-specific init script.
# The current directory is the newly-created worktree.
#
# Examples:
#   echo "Worktree created at: $PWD"
#   git config core.hooksPath ~/.githooks
`;

const INIT_DIR = path.join(os.homedir(), '.geet', 'init');

/**
 * Shared scaffolding logic for init scripts.
 * Creates, copies, or edits the script at targetPath using stubContent as the
 * template when no source file is provided.
 */
async function scaffoldInitScript(targetPath, stubContent) {
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
  const srcPath = srcInput.trim();

  if (srcPath) {
    try {
      await access(srcPath, constants.F_OK);
    } catch {
      const err = new Error(`Source file not found: ${srcPath}`);
      err.gitMessage = err.message;
      throw err;
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
        if (renameErr.code === 'EXDEV') {
          await copyFile(srcPath, targetPath);
          const { unlink } = await import('fs/promises');
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
export async function configInitScriptAction(options) {
  if (options.default) {
    intro('geet config init-script --default');
    await scaffoldInitScript(path.join(INIT_DIR, 'default.sh'), DEFAULT_STUB_CONTENT);
    return;
  }

  intro('geet config init-script');

  const s = spinner();
  s.start('Detecting repo name from worktrees...');
  let repoName;
  try {
    const worktrees = await listWorktrees();
    const main = worktrees.find((w) => w.isMain);
    if (!main) throw new Error('Could not find main worktree.');
    repoName = path.basename(main.path);
  } catch (err) {
    s.stop('');
    const error = new Error(`Failed to detect repo name: ${err.message}`);
    error.gitMessage = error.message;
    throw error;
  }
  s.stop(`Repo: ${repoName}`);

  await scaffoldInitScript(path.join(INIT_DIR, `${repoName}.sh`), REPO_STUB_CONTENT);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Opens the given file in the user's $EDITOR (falls back to vi).
 * Waits for the editor to exit before continuing.
 *
 * @param {string} filePath
 */
function openInEditor(filePath) {
  return new Promise((resolve, reject) => {
    const editorEnv = process.env.EDITOR || 'vi';
    const [editor, ...editorArgs] = editorEnv.split(/\s+/);
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

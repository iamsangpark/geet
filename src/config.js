/**
 * config.js
 * Loads geet configuration from (in ascending priority order):
 *   1. ~/.geet/config     — global user defaults
 *   2. .env               — project-level defaults (commit this)
 *   3. .env.local         — local overrides (do NOT commit)
 *   4. process.env        — shell environment (always wins)
 *
 * Supported keys:
 *   GEET_WORKTREE_BASE    — base directory for smart-add worktrees
 *                           default: ~/worktrees
 *   GEET_BRANCH_PREFIX    — prefix prepended to the branch name in smart-add
 *                           default: "" (no prefix)
 *   GEET_SYMLINK_PATHS    — comma-separated relative paths to symlink from the
 *                           main worktree into each newly-created worktree
 *                           example: .env.local,node_modules,.idea
 *
 * Init scripts (no config key needed):
 *   ~/.geet/init/<repo-name>.sh — executed in the new worktree directory after
 *                                  creation, where <repo-name> is the basename
 *                                  of the main worktree path. Must be executable
 *                                  (chmod +x ~/.geet/init/my-repo.sh).
 *
 * Example .env / ~/.geet/config:
 *   GEET_WORKTREE_BASE=~/dev/worktrees
 *   GEET_BRANCH_PREFIX=sp/
 *   GEET_SYMLINK_PATHS=.env.local,node_modules
 */

import path from 'path';
import os from 'os';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { config, parse } from 'dotenv';

// ── Config constants ──────────────────────────────────────────────────────────

/** Absolute path to the global ~/.geet/config file. */
export const GLOBAL_CONFIG_PATH = path.join(os.homedir(), '.geet', 'config');

/**
 * Metadata for every supported config key.
 * Used by `geet config` to drive prompts and file I/O.
 */
export const CONFIG_KEYS = [
  {
    key: 'GEET_WORKTREE_BASE',
    label: 'Worktree base directory',
    placeholder: '~/dev/worktrees',
    hint: 'base dir for smart-add worktrees',
  },
  {
    key: 'GEET_BRANCH_PREFIX',
    label: 'Branch prefix',
    placeholder: 'sp/',
    hint: 'prepended to smart-add branch names',
  },
  {
    key: 'GEET_SYMLINK_PATHS',
    label: 'Symlink paths (comma-separated)',
    placeholder: '.env.local,node_modules',
    hint: 'symlinked into each new worktree',
  },
];

// ── Env-file I/O helpers ──────────────────────────────────────────────────────

/**
 * Reads a dotenv-style file and returns a plain object of its key/value pairs.
 * Returns {} if the file does not exist.
 *
 * @param {string} filePath
 * @returns {Promise<Record<string, string>>}
 */
export async function readEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Writes (merges) key/value pairs into a dotenv-style file.
 *
 * Strategy: line-based merge — existing lines / comments are preserved.
 * Keys already present are updated in place; new keys are appended.
 * Creates the file (and any parent directories) if it doesn't exist.
 *
 * @param {string} filePath
 * @param {Record<string, string>} values  — only non-empty values are written
 */
export async function writeEnvValues(filePath, values) {
  await mkdir(path.dirname(filePath), { recursive: true });

  let lines;
  try {
    const raw = await readFile(filePath, 'utf8');
    lines = raw.split('\n');
    // Remove trailing empty line so we control newlines at the end
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
  } catch (err) {
    if (err.code === 'ENOENT') {
      lines = [];
    } else {
      throw err;
    }
  }

  const updated = new Set();

  // Replace existing KEY=... lines in place
  lines = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)\s*=/);
    if (match && Object.hasOwn(values, match[1]) && values[match[1]] !== '') {
      updated.add(match[1]);
      return `${match[1]}=${values[match[1]]}`;
    }
    return line;
  });

  // Append keys that weren't already in the file
  for (const [key, value] of Object.entries(values)) {
    if (!updated.has(key) && value !== '') {
      lines.push(`${key}=${value}`);
    }
  }

  await writeFile(filePath, lines.join('\n') + '\n', 'utf8');
}

// ── dotenv loading (side-effects) ─────────────────────────────────────────────

// 1. Global user defaults (~/.geetrc) — lowest priority
config({ path: GLOBAL_CONFIG_PATH, override: false, quiet: true });

// 2. Project-level .env — overrides ~/.geetrc
config({ path: path.resolve('.env'), override: true, quiet: true });

// 3. Local overrides (.env.local) — overrides .env, not committed
config({ path: path.resolve('.env.local'), override: true, quiet: true });

function resolveHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export const WORKTREE_BASE = resolveHome(
  process.env.GEET_WORKTREE_BASE ?? path.join(os.homedir(), 'worktrees'),
);

export const BRANCH_PREFIX = process.env.GEET_BRANCH_PREFIX ?? '';

export const SYMLINK_PATHS = (process.env.GEET_SYMLINK_PATHS ?? '')
  .split(',')
  .map((p) => p.trim())
  .filter(Boolean);

// ── Project map (~/.geet/project-map.json) ────────────────────────────────────

/** Absolute path to the global project map file. */
export const GLOBAL_PROJECT_MAP_PATH = path.join(os.homedir(), '.geet', 'project-map.json');

/**
 * Reads the repo → project name mapping from ~/.geet/project-map.json.
 * Returns {} if the file does not exist.
 *
 * @returns {Promise<Record<string, string>>}
 */
export async function readProjectMap() {
  try {
    const raw = await readFile(GLOBAL_PROJECT_MAP_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/**
 * Writes the full repo → project name mapping to ~/.geet/project-map.json.
 *
 * @param {Record<string, string>} map
 */
export async function writeProjectMap(map) {
  await mkdir(path.dirname(GLOBAL_PROJECT_MAP_PATH), { recursive: true });
  await writeFile(GLOBAL_PROJECT_MAP_PATH, JSON.stringify(map, null, 2) + '\n', 'utf8');
}

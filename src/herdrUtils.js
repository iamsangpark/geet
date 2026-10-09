/**
 * herdrUtils.js
 * All herdr subprocess operations via execa.
 * Every exported function returns structured data or throws an Error
 * with a `.gitMessage` property containing a clean, user-facing message.
 */

import { execa } from 'execa';
import { HERDR_MODE } from './config.js';

// ── Detection ─────────────────────────────────────────────────────────────────

/** True when running inside a herdr-managed pane. */
export function isInsideHerdr() {
  return process.env.HERDR_ENV === '1';
}

/**
 * Effective herdr mode: the configured GEET_HERDR value inside herdr,
 * otherwise always 'off'.
 * @returns {'off' | 'prompt' | 'auto'}
 */
export function herdrMode() {
  return isInsideHerdr() ? HERDR_MODE : 'off';
}

// ── Error Handling ────────────────────────────────────────────────────────────

function herdrError(message) {
  const error = new Error(`herdr: ${message}`);
  error.gitMessage = error.message;
  return error;
}

/**
 * Run a herdr CLI command. Returns the parsed `result` object on success,
 * throws a cleaned Error on failure (including herdr's JSON `error` responses).
 */
async function herdr(args) {
  let stdout;
  let stderr;
  try {
    ({ stdout, stderr } = await execa('herdr', args, { reject: false }));
  } catch (err) {
    throw herdrError(err.code === 'ENOENT' ? 'binary not found in PATH' : err.message);
  }

  let response;
  try {
    // herdr prints successes to stdout and JSON errors to stderr
    response = JSON.parse(stdout || stderr);
  } catch {
    throw herdrError((stderr || stdout).trim() || 'empty or unparseable response');
  }

  if (response.error) throw herdrError(response.error.message ?? response.error.code);
  return response.result;
}

// ── Worktrees & Workspaces ────────────────────────────────────────────────────

/**
 * Lists the worktrees herdr knows about for a repo.
 * @param {string} repoPath
 * @returns {Promise<Array<{ path: string, branch: string | null, open_workspace_id: string | null }>>}
 */
export async function listHerdrWorktrees(repoPath) {
  const result = await herdr(['worktree', 'list', '--cwd', repoPath]);
  return result.worktrees ?? [];
}

/**
 * Opens an existing worktree checkout as a herdr workspace and focuses it.
 * If a workspace is already open for it, herdr just focuses that one.
 * @returns {Promise<{ workspaceId: string, alreadyOpen: boolean }>}
 */
export async function openHerdrWorktree({ repoPath, dir, label }) {
  const result = await herdr([
    'worktree', 'open',
    '--cwd', repoPath,
    '--path', dir,
    '--label', label,
    '--focus',
  ]);
  return { workspaceId: result.workspace.workspace_id, alreadyOpen: Boolean(result.already_open) };
}

/** Closes a herdr workspace (herdr state only — files are untouched). */
export async function closeHerdrWorkspace(workspaceId) {
  await herdr(['workspace', 'close', workspaceId]);
}

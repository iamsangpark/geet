/**
 * herdrUtils.ts
 * All herdr subprocess operations via execa.
 * Every exported function returns structured data or throws an Error
 * with a `.gitMessage` property containing a clean, user-facing message.
 */

import { execa } from 'execa';
import { HERDR_MODE, type HerdrMode } from '../../../config.ts';
import { GeetError, errorCode, errorMessage } from '../../../utils/errors.ts';

// ── Detection ─────────────────────────────────────────────────────────────────

/** True when running inside a herdr-managed pane. */
function isInsideHerdr(): boolean {
  return process.env.HERDR_ENV === '1';
}

/**
 * Effective herdr mode: the configured GEET_HERDR value inside herdr,
 * otherwise always 'off'.
 */
export function herdrMode(): HerdrMode {
  return isInsideHerdr() ? HERDR_MODE : 'off';
}

// ── Error Handling ────────────────────────────────────────────────────────────

function herdrError(message: string): GeetError {
  return new GeetError(`herdr: ${message}`);
}

interface HerdrResponse {
  error?: { message?: string; code?: string };
  result?: HerdrResult;
}

interface HerdrResult {
  worktrees?: HerdrWorktree[];
  workspace?: { workspace_id: string };
  already_open?: boolean;
}

export interface HerdrWorktree {
  path: string;
  branch: string | null;
  open_workspace_id: string | null;
}

/**
 * Run a herdr CLI command. Returns the parsed `result` object on success,
 * throws a cleaned Error on failure (including herdr's JSON `error` responses).
 */
async function herdr(args: string[]): Promise<HerdrResult> {
  let stdout: string | undefined;
  let stderr: string | undefined;
  try {
    ({ stdout, stderr } = await execa('herdr', args, { reject: false }));
  } catch (err) {
    throw herdrError(errorCode(err) === 'ENOENT' ? 'binary not found in PATH' : errorMessage(err));
  }

  let response: HerdrResponse;
  try {
    // herdr prints successes to stdout and JSON errors to stderr
    response = JSON.parse(stdout || stderr || '');
  } catch {
    throw herdrError((stderr || stdout || '').trim() || 'empty or unparseable response');
  }

  if (response.error)
    throw herdrError(response.error.message ?? response.error.code ?? 'unknown error');
  return response.result ?? {};
}

// ── Worktrees & Workspaces ────────────────────────────────────────────────────

/**
 * Lists the worktrees herdr knows about for a repo.
 */
export async function listHerdrWorktrees(repoPath: string): Promise<HerdrWorktree[]> {
  const result = await herdr(['worktree', 'list', '--cwd', repoPath]);
  return result.worktrees ?? [];
}

/**
 * Opens an existing worktree checkout as a herdr workspace and focuses it.
 * If a workspace is already open for it, herdr just focuses that one.
 */
export async function openHerdrWorktree({
  repoPath,
  dir,
  label,
}: {
  repoPath: string;
  dir: string;
  label: string;
}): Promise<{ workspaceId: string; alreadyOpen: boolean }> {
  const result = await herdr([
    'worktree',
    'open',
    '--cwd',
    repoPath,
    '--path',
    dir,
    '--label',
    label,
    '--focus',
  ]);
  if (!result.workspace) throw herdrError('response did not include a workspace');
  return { workspaceId: result.workspace.workspace_id, alreadyOpen: Boolean(result.already_open) };
}

/** Closes a herdr workspace (herdr state only — files are untouched). */
export async function closeHerdrWorkspace(workspaceId: string): Promise<void> {
  await herdr(['workspace', 'close', workspaceId]);
}

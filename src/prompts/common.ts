/**
 * prompts/common.ts
 * Shared @clack/prompts helpers.
 *
 * Key convention: every prompt result must be passed through guardCancel().
 * If the user presses ESC or Ctrl+C, @clack/prompts resolves the promise to
 * a special Symbol. isCancel() detects it, and guardCancel() calls p.cancel()
 * then process.exit(0) — a clean exit with no error.
 */

import * as p from '@clack/prompts';
import search from '@inquirer/search';
import { WORKTREE_LIST_SIZE } from '../config.ts';

export interface SearchOption<T> {
  value: T;
  label: string;
  hint?: string;
  searchText: string;
}

// ── Cancel Guard ──────────────────────────────────────────────────────────────

/**
 * Call immediately after any @clack/prompts prompt.
 * Exits cleanly if the user pressed ESC or Ctrl+C.
 */
export function guardCancel<T>(value: T | symbol, message = 'Operation cancelled.'): T {
  if (p.isCancel(value)) {
    p.cancel(message);
    process.exit(0);
  }
  return value as T;
}

// ── Wrappers ──────────────────────────────────────────────────────────────────

export const intro = (title?: string) => p.intro(title);
export const outro = (msg?: string) => p.outro(msg);
export const logInfo = (msg: string) => p.log.info(msg);
export const logWarn = (msg: string) => p.log.warn(msg);
export const logError = (msg: string) => p.log.error(msg);
export const logSuccess = (msg: string) => p.log.success(msg);

/**
 * Creates a spinner. Usage:
 *   const s = spinner();
 *   s.start('Loading...');
 *   s.stop('Done.');
 */
export const spinner = () => p.spinner();

// ── Fuzzy Search Helper ───────────────────────────────────────────────────────

/** True when the characters of `input` appear in `target` in order (case-insensitive). */
export function fuzzyMatch(input: string | undefined, target: string): boolean {
  if (!input) return true;
  const q = input.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export async function searchSelect<T>(message: string, options: SearchOption<T>[]): Promise<T> {
  // @inquirer/search has no ESC handling, so abort the prompt on a bare Escape keypress
  const controller = new AbortController();
  const onKeypress = (_str: unknown, key?: { name?: string }) => {
    if (key?.name === 'escape') controller.abort();
  };
  process.stdin.on('keypress', onKeypress);

  try {
    return await search(
      {
        message,
        pageSize: WORKTREE_LIST_SIZE === 0 ? Math.max(options.length, 1) : WORKTREE_LIST_SIZE,
        source: (input) =>
          options
            .filter((o) => fuzzyMatch(input, o.searchText))
            .map((o) => ({ name: o.label, value: o.value, description: o.hint })),
      },
      { signal: controller.signal },
    );
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'ExitPromptError' || err.name === 'AbortPromptError')
    ) {
      p.cancel('Operation cancelled.');
      process.exit(0);
    }
    throw err;
  } finally {
    process.stdin.off('keypress', onKeypress);
  }
}

/**
 * Prompts the user to confirm an action (yes/no).
 */
export async function promptConfirm(message: string): Promise<boolean> {
  const confirmed = await p.confirm({ message });
  return guardCancel(confirmed);
}

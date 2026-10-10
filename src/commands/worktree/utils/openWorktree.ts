import path from 'path';
import { userMessage } from '../../../utils/errors.ts';
import { outro, logWarn } from '../../../prompts/common.ts';
import { promptHerdrOpen } from '../../../prompts/worktree.ts';
import { herdrMode, listHerdrWorktrees, openHerdrWorktree } from './herdr.ts';
import { spawnShellIn } from './shell.ts';

/**
 * Final step for new/list: open the worktree as a herdr workspace (or switch to
 * its existing one) when GEET_HERDR allows it and we're inside herdr; otherwise
 * — or if herdr fails — spawn a shell in the directory.
 *
 * `dir` is the worktree path; `mainWorktreePath` is the repo root, used as herdr's repo context.
 */
export async function openWorktree(
  dir: string,
  mainWorktreePath?: string,
  { alreadyOpen = false }: { alreadyOpen?: boolean } = {},
) {
  const mode = herdrMode();

  if (mode !== 'off' && mainWorktreePath) {
    const choice = mode === 'prompt' ? await promptHerdrOpen(alreadyOpen) : 'herdr';

    if (choice === 'herdr') {
      try {
        const label = path.basename(dir);
        const result = await openHerdrWorktree({ repoPath: mainWorktreePath, dir, label });
        outro(`${result.alreadyOpen ? 'Switched to' : 'Opened'} herdr workspace: ${label}`);
        return;
      } catch (err) {
        logWarn(`${userMessage(err)} — falling back to a shell.`);
      }
    }
  }

  outro(`Spawning shell in: ${dir}`);
  spawnShellIn(dir);
}

/**
 * Best-effort lookup of herdr workspaces that are open for the given worktrees.
 * Returns a Map of worktree path → open workspace id. Empty when herdr is off
 * or unreachable.
 */
export async function openHerdrWorkspaces(mainWorktreePath?: string): Promise<Map<string, string>> {
  const open = new Map<string, string>();
  if (herdrMode() === 'off' || !mainWorktreePath) return open;

  try {
    for (const w of await listHerdrWorktrees(mainWorktreePath)) {
      if (w.open_workspace_id) open.set(path.resolve(w.path), w.open_workspace_id);
    }
  } catch {
    // herdr unreachable — treat as "nothing open"
  }
  return open;
}

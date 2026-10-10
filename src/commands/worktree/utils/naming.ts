import path from 'path';
import { WORKTREE_BASE, BRANCH_PREFIX } from '../../../config.ts';

export interface WorktreeNameParts {
  projectName: string;
  jiraName?: string;
  description: string;
}

/**
 * Builds the worktree folder, directory and branch from the prompt answers.
 * Spaces in the description become underscores; a Jira key prefixes the folder name.
 */
export function buildWorktreeNames({ projectName, jiraName, description }: WorktreeNameParts) {
  const slug = description.trim().replace(/ /g, '_');
  const folderName = jiraName ? `${jiraName}-${slug}` : slug;
  return {
    folderName,
    dir: path.join(WORKTREE_BASE, projectName, folderName),
    branch: `${BRANCH_PREFIX}${folderName}`,
  };
}

/**
 * Splits an existing worktree path back into the prompt answers (the inverse of
 * `buildWorktreeNames`), used to pre-fill the rename prompts.
 */
export function parseWorktreePath(worktreePath: string): Required<WorktreeNameParts> {
  const folderName = path.basename(worktreePath);
  const jiraMatch = folderName.match(/^([A-Z]+-\d+)-(.+)$/);
  return {
    projectName: path.basename(path.dirname(worktreePath)),
    jiraName: jiraMatch?.[1] ?? '',
    description: (jiraMatch?.[2] ?? folderName).replace(/_/g, ' '),
  };
}

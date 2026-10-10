import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/config.ts', () => ({
  WORKTREE_BASE: '/wt',
  BRANCH_PREFIX: 'sang/',
}));

import {
  buildWorktreeNames,
  parseWorktreePath,
} from '../../../../src/commands/worktree/utils/naming.ts';

describe('buildWorktreeNames', () => {
  it('prefixes the folder with the jira key and the branch with BRANCH_PREFIX', () => {
    expect(
      buildWorktreeNames({ projectName: 'app', jiraName: 'PROJ-12', description: ' fix  login ' }),
    ).toEqual({
      folderName: 'PROJ-12-fix__login',
      dir: path.join('/wt', 'app', 'PROJ-12-fix__login'),
      branch: 'sang/PROJ-12-fix__login',
    });
  });

  it('omits the jira prefix when there is no jira key', () => {
    const names = buildWorktreeNames({ projectName: 'app', description: 'spike auth' });
    expect(names.folderName).toBe('spike_auth');
    expect(names.branch).toBe('sang/spike_auth');
  });
});

describe('parseWorktreePath', () => {
  it('splits project, jira key and description', () => {
    expect(parseWorktreePath('/wt/app/PROJ-12-fix_login')).toEqual({
      projectName: 'app',
      jiraName: 'PROJ-12',
      description: 'fix login',
    });
  });

  it('treats the whole folder as the description when there is no jira key', () => {
    expect(parseWorktreePath('/wt/app/spike_auth')).toEqual({
      projectName: 'app',
      jiraName: '',
      description: 'spike auth',
    });
  });

  it('round-trips with buildWorktreeNames', () => {
    const parts = { projectName: 'app', jiraName: 'AB-1', description: 'do the thing' };
    expect(parseWorktreePath(buildWorktreeNames(parts).dir)).toEqual(parts);
  });
});

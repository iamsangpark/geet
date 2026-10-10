import type { Command } from 'commander';
import { GeetError } from '../../utils/errors.ts';
import { describeWithSubcommands } from '../../utils/commander.ts';
import { worktreeNewAction, worktreeAddAction } from './create.ts';
import { worktreeListAction } from './list.ts';
import { worktreeRemoveAction, worktreePruneAction } from './remove.ts';
import { worktreeRenameAction } from './rename.ts';
import { worktreeLinkFixAction } from './linkFix.ts';
import { worktreePullAction, worktreeMergeAction } from './pullMerge.ts';

export function registerWorktreeCommand(program: Command) {
  const worktreeCmd = program
    .command('worktree')
    .alias('wt')
    .action((_options, cmd) => {
      if (cmd.args.length > 0) {
        throw new GeetError(
          `Unknown subcommand: "${cmd.args[0]}". Run "geet worktree --help" to see available subcommands.`,
        );
      }
      return worktreeListAction();
    });

  worktreeCmd
    .command('new')
    .description(
      'Interactively create a new branch and worktree (use -f and -b together to skip prompts)',
    )
    .option('-f, --folder <dir>', 'Target directory for the new worktree')
    .option('-b, --branch <branch>', 'Branch name for the new worktree')
    .option('--no-init', 'Skip running init scripts after worktree creation')
    .action(worktreeNewAction);

  worktreeCmd
    .command('add')
    .description('Check out an existing local branch as a new worktree')
    .option('--no-init', 'Skip running init scripts after worktree creation')
    .action(worktreeAddAction);

  worktreeCmd
    .command('list')
    .description(
      'List worktrees; copies path to clipboard and opens a shell (or herdr workspace when GEET_HERDR is enabled) in selection',
    )
    .action(worktreeListAction);

  worktreeCmd
    .command('remove')
    .description(
      'Interactively select worktrees to remove (use --path or --branch to target one directly)',
    )
    .option('--path <dir>', 'Remove the worktree at this path')
    .option('-b, --branch <branch>', 'Remove the worktree with this branch name')
    .action(worktreeRemoveAction);

  worktreeCmd
    .command('prune')
    .description('Fetch from origin and remove worktrees whose remote branches are closed')
    .action(worktreePruneAction);

  worktreeCmd
    .command('rename')
    .description('Interactively rename a worktree: move its folder and rename its branch')
    .action(worktreeRenameAction);

  worktreeCmd
    .command('link-fix')
    .description('Re-link GEET_SYMLINK_PATHS from the main worktree into a selected worktree')
    .action(worktreeLinkFixAction);

  worktreeCmd
    .command('pull')
    .description('Interactively select a worktree and pull the latest changes for its branch')
    .action(worktreePullAction);

  worktreeCmd
    .command('merge')
    .description('Interactively select a worktree branch to merge into the current branch')
    .option('-p, --pull', 'Pull the target branch from origin before merging')
    .action(worktreeMergeAction);

  describeWithSubcommands(worktreeCmd, 'Manage git worktrees');
}

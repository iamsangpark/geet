import type { Command } from 'commander';
import { describeWithSubcommands } from '../../utils/commander.ts';
import { configListAction } from './list.ts';
import { configGlobalAction, configLocalAction, configSetAction } from './edit.ts';
import { configProjectMapAction } from './projectMap.ts';
import { configInitScriptAction } from './initScript.ts';

export function registerConfigCommand(program: Command) {
  const configCmd = program.command('config').alias('cfg');

  configCmd
    .command('list')
    .description('List config values currently set; use -a to show every option plus global values')
    .option('-a, --all', 'Show all options (set or not) and values set in the global config')
    .action(configListAction);

  configCmd
    .command('global')
    .description('Interactively create/update the global ~/.geet/config file')
    .action(configGlobalAction);

  configCmd
    .command('local')
    .description('Create/update .env or .env.local in the current directory')
    .action(configLocalAction);

  configCmd
    .command('set')
    .description('Update a single config value in a chosen file')
    .action(configSetAction);

  configCmd
    .command('init-script')
    .description(
      'Scaffold the worktree init script for this repo (~/.geet/init/<repo>.sh); use -d for the default script',
    )
    .option('-d, --default', 'scaffold the default init script (~/.geet/init/default.sh) instead')
    .action(configInitScriptAction);

  configCmd
    .command('project-map')
    .description(
      'Set the project name for this repo — used by "worktree new" to skip the project name prompt',
    )
    .action(configProjectMapAction);

  describeWithSubcommands(configCmd, 'Manage geet config & init scripts');
}

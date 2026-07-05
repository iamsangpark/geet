#!/usr/bin/env node
/**
 * src/index.js
 * Main CLI entry point for `geet` — a personal git productivity wrapper.
 *
 * Architecture:
 *   - commander   : subcommand registration and argument parsing
 *   - omelette    : shell autocompletion (bash/zsh)
 *                   omelette is CJS-only, so we import it via createRequire
 *
 * ── Shell Autocompletion Setup ─────────────────────────────────────────────
 *
 *   Install:   geet --setup-completion && source ~/.zshrc   (or ~/.bashrc)
 *   Remove:    geet --cleanup-completion
 *
 *   After installing, pressing Tab after `geet ` will complete subcommands.
 *
 * ── Global Error Handling ─────────────────────────────────────────────────
 *
 *   program.parseAsync() is wrapped in a try/catch. Any error thrown from
 *   a command action that isn't caught within the command itself is caught
 *   here and displayed as a clean message (using err.gitMessage if present).
 *   Raw stack traces never reach the terminal.
 */

import { createRequire } from 'module';
import { Command } from 'commander';

// ── omelette (CJS-only, must use createRequire in ESM) ────────────────────────
const require = createRequire(import.meta.url);
const omelette = require('omelette');

// ── Command action imports ────────────────────────────────────────────────────
import { checkoutAction } from './commands/checkout.js';
import { stashAction, stashPopAction, stashListPopAction } from './commands/stash.js';
import {
  worktreeNewAction,
  worktreeAddAction,
  worktreeListAction,
  worktreeRemoveAction,
  worktreePruneAction,
  worktreeCopyPathAction,
  worktreeRenameAction,
  worktreeLinkFixAction,
} from './commands/worktree.js';
import { mergeReleaseAction } from './commands/mergeRelease.js';
import {
  configGlobalAction,
  configLocalAction,
  configSetAction,
  configInitScriptAction,
  configProjectMapAction,
} from './commands/config.js';

// ── Autocompletion Setup ──────────────────────────────────────────────────────

const completion = omelette('geet <command>');

// Top-level subcommand completions
completion.on('command', ({ reply }) => {
  reply(['checkout', 'co', 'stash', 'sts', 'worktree', 'wt', 'merge-release', 'config', 'cfg']);
});

// Subcommand completions for `geet stash <sub>`
completion.on('stash', ({ reply }) => {
  reply(['pop', 'list']);
});

// Subcommand completions for `ga worktree <sub>`
completion.on('worktree', ({ reply }) => {
  reply(['new', 'add', 'list', 'remove', 'prune', 'copy-path', 'rename', 'link-fix']);
});

// Subcommand completions for `geet config <sub>`
completion.on('config', ({ reply }) => {
  reply(['global', 'local', 'set', 'init-script', 'project-map']);
});

// omelette.init() must be called before program.parse().
// When Tab is pressed, the shell sets COMP_LINE / COMP_POINT, omelette detects
// those env vars in init(), writes completions to stdout, and exits — so the
// commander setup below never runs during a completion call.
completion.init();

// ── Handle completion setup flags (before commander, to avoid conflicts) ──────

if (process.argv.includes('--setup-completion')) {
  completion.setupShellInitFile();
  console.log('✓ Shell completion installed. Run: source ~/.zshrc  (or ~/.bashrc)');
  process.exit(0);
}

if (process.argv.includes('--cleanup-completion')) {
  completion.cleanupShellInitFile();
  console.log('✓ Shell completion removed.');
  process.exit(0);
}

// ── Commander Program ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name('geet')
  .description('Personal git productivity CLI')
  .version('1.0.0')
  .addHelpText('after', `
Autocompletion:
  geet --setup-completion     Install tab completion for bash/zsh
  geet --cleanup-completion   Remove tab completion
`);

// ── checkout ──────────────────────────────────────────────────────────────────

program
  .command('checkout [branch]')
  .alias('co')
  .description('Checkout a branch with uncommitted-change safety guard')
  .action(checkoutAction);

// ── stash (with nested subcommands) ───────────────────────────────────────────
//
// commander resolves subcommand names *before* positional args on the parent,
// so `geet stash pop` → stashPopAction, `geet stash "my msg"` → stashAction("my msg").

const stashCmd = program
  .command('stash')
  .alias('sts')
  .description('Stash changes, prompting for a message  (subcommands: pop, list)')
  .option('-m, --message <msg>', 'Stash message (skips the prompt)')
  .action(stashAction);

stashCmd
  .command('pop')
  .description('Pop the most recent stash (with uncommitted-change guard)')
  .action(stashPopAction);

stashCmd
  .command('list')
  .description('Interactively pick a stash entry to pop')
  .action(stashListPopAction);

// ── worktree ──────────────────────────────────────────────────────────────────

const worktreeCmd = program
  .command('worktree')
  .alias('wt')
  .description('Manage git worktrees  (subcommands: new, add, list, remove, prune, copy-path, rename, link-fix)')
  .action((options, cmd) => {
    if (cmd.args.length > 0) {
      const err = new Error();
      err.gitMessage = `Unknown subcommand: "${cmd.args[0]}". Run "geet worktree --help" to see available subcommands.`;
      throw err;
    }
    return worktreeListAction(options);
  });

worktreeCmd
  .command('new')
  .description('Interactively create a new branch and worktree (use -f and -b together to skip prompts)')
  .option('-f, --folder <dir>', 'Target directory for the new worktree')
  .option('-b, --branch <branch>', 'Branch name for the new worktree')
  .action(worktreeNewAction);

worktreeCmd
  .command('add')
  .description('Check out an existing local branch as a new worktree')
  .action(worktreeAddAction);

worktreeCmd
  .command('list')
  .description('List worktrees; copies path to clipboard and opens shell in selection')
  .action(worktreeListAction);

worktreeCmd
  .command('remove')
  .description('Interactively select a worktree to remove')
  .action(worktreeRemoveAction);

worktreeCmd
  .command('prune')
  .description('Fetch from origin and remove worktrees whose remote branches are closed')
  .action(worktreePruneAction);

worktreeCmd
  .command('copy-path')
  .description('Copy the current worktree folder path to clipboard')
  .action(worktreeCopyPathAction);

worktreeCmd
  .command('rename')
  .description('Interactively rename a worktree: move its folder and rename its branch')
  .action(worktreeRenameAction);

worktreeCmd
  .command('link-fix')
  .description('Re-link GEET_SYMLINK_PATHS from the main worktree into a selected worktree')
  .action(worktreeLinkFixAction);

// ── config ────────────────────────────────────────────────────────────────────

const configCmd = program
  .command('config')
  .alias('cfg')
  .description('Manage geet config & init scripts  (subcommands: global, local, set, init-script, project-map)');

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
  .description('Scaffold the worktree init script for this repo (~/.geet/init/<repo>.sh); use -d for the default script')
  .option('-d, --default', 'scaffold the default init script (~/.geet/init/default.sh) instead')
  .action(configInitScriptAction);

configCmd
  .command('project-map')
  .description('Set the project name for this repo — used by "worktree new" to skip the project name prompt')
  .action(configProjectMapAction);

// ── merge-release ─────────────────────────────────────────────────────────────

program
  .command('merge-release <source> <dest>')
  .description('Pull both branches and merge <source> into <dest>')
  .option(
    '-n, --no-change',
    'Merge using -X ours --no-commit (staged only, for manual inspection)',
  )
  .action(mergeReleaseAction);

// ── Parse & Global Error Handler ─────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const message = err.gitMessage || err.message || 'An unexpected error occurred.';
  // Use process.stderr directly so the message always appears, even if clack is mid-render
  process.stderr.write(`\n  Error: ${message}\n\n`);
  process.exit(1);
}

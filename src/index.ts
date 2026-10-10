#!/usr/bin/env node
/**
 * src/index.ts
 * Main CLI entry point for `geet` — a personal git productivity wrapper.
 *
 * Architecture:
 *   - commander   : subcommand registration and argument parsing
 *                   (each command module exports its own register*Command)
 *   - omelette    : shell autocompletion (bash/zsh), derived from the commander tree
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
import { userMessage } from './utils/errors.ts';
import { registerCheckoutCommand } from './commands/checkout.ts';
import { registerStashCommand } from './commands/stash.ts';
import { registerWorktreeCommand } from './commands/worktree/index.ts';
import { registerCopyCommand } from './commands/copy.ts';
import { registerConfigCommand } from './commands/config/index.ts';
import { registerMergeReleaseCommand } from './commands/mergeRelease.ts';

// ── CJS-only dependencies (must use createRequire in ESM) ─────────────────────
const require = createRequire(import.meta.url);
const omelette = require('omelette') as (template: string) => Completion;
// Resolves to the repo's package.json from both src/ and dist/
const { version } = require('../package.json') as { version: string };

interface Completion {
  on(
    event: string,
    handler: (ctx: { before: string; reply: (items: string[]) => void }) => void,
  ): void;
  init(): void;
  setupShellInitFile(): void;
  cleanupShellInitFile(): void;
}

// ── Commander Program ─────────────────────────────────────────────────────────

const program = new Command();

program
  .name('geet')
  .description('Personal git productivity CLI')
  .version(version)
  .addHelpText(
    'after',
    `
Autocompletion:
  geet --setup-completion     Install tab completion for bash/zsh
  geet --cleanup-completion   Remove tab completion
`,
  );

registerCheckoutCommand(program);
registerStashCommand(program);
registerWorktreeCommand(program);
registerCopyCommand(program);
registerConfigCommand(program);
registerMergeReleaseCommand(program);

// ── Autocompletion ────────────────────────────────────────────────────────────
// Derived from the commander tree: `geet <command>` completes command names and
// aliases; `geet <command> <sub>` completes that command's subcommands. omelette
// emits `$<n>` for the n-th word and passes the previous word as `before`.

const completion = omelette('geet <command>');

const names = (cmd: Command) => cmd.commands.flatMap((c) => [c.name(), ...c.aliases()]);

completion.on('command', ({ reply }) => reply(names(program)));

completion.on('$2', ({ before, reply }) => {
  const cmd = program.commands.find((c) => c.name() === before || c.aliases().includes(before));
  reply(cmd ? names(cmd) : []);
});

// omelette.init() must be called before program.parse().
// When Tab is pressed, the shell sets COMP_LINE / COMP_POINT, omelette detects
// those env vars in init(), writes completions to stdout, and exits — so
// commander never runs during a completion call.
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

// ── Parse & Global Error Handler ─────────────────────────────────────────────

try {
  await program.parseAsync(process.argv);
} catch (err) {
  const message = userMessage(err) || 'An unexpected error occurred.';
  // Use process.stderr directly so the message always appears, even if clack is mid-render
  process.stderr.write(`\n  Error: ${message}\n\n`);
  process.exit(1);
}

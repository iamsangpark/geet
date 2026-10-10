import type { Command } from 'commander';

/**
 * Sets a command's description and appends the names of its registered
 * subcommands, so the help text can't drift from what's actually registered.
 * Call after the subcommands are added.
 */
export function describeWithSubcommands(cmd: Command, description: string): Command {
  const names = cmd.commands.map((c) => c.name());
  return cmd.description(`${description}  (subcommands: ${names.join(', ')})`);
}

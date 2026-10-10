import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { describeWithSubcommands } from '../../src/utils/commander.ts';

describe('describeWithSubcommands', () => {
  it('appends the registered subcommand names in order', () => {
    const cmd = new Command('group');
    cmd.command('one');
    cmd.command('two').alias('2');
    describeWithSubcommands(cmd, 'Does things');
    expect(cmd.description()).toBe('Does things  (subcommands: one, two)');
  });
});

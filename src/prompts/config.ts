/**
 * prompts/config.ts
 * Prompts for `geet config`.
 */

import path from 'path';
import * as p from '@clack/prompts';
import { CONFIG_KEYS, GLOBAL_CONFIG_PATH, type ConfigKey } from '../config.ts';
import { guardCancel } from './common.ts';

/**
 * Iterates over all CONFIG_KEYS and prompts the user for each value.
 * `currentValues` pre-fills the text inputs so editing feels natural.
 * Empty inputs are omitted from the returned object.
 */
export async function promptConfigValues(
  currentValues: Record<string, string> = {},
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const { key, label, placeholder } of CONFIG_KEYS) {
    const value = guardCancel(
      await p.text({
        message: `${label}:`,
        placeholder,
        initialValue: currentValues[key] ?? '',
      }),
    );
    const trimmed = value?.trim();
    if (trimmed) result[key] = trimmed;
  }
  return result;
}

/**
 * Prompts the user to choose which config file to target (all three locations).
 * Returns the absolute path of the chosen file.
 */
export async function promptSelectConfigFile(): Promise<string> {
  const file = await p.select<string>({
    message: 'Which config file do you want to update?',
    options: [
      {
        value: GLOBAL_CONFIG_PATH,
        label: 'Global',
        hint: GLOBAL_CONFIG_PATH,
      },
      {
        value: path.resolve('.env'),
        label: '.env',
        hint: `${path.resolve('.env')} (project defaults, commit this)`,
      },
      {
        value: path.resolve('.env.local'),
        label: '.env.local',
        hint: `${path.resolve('.env.local')} (local overrides, do NOT commit)`,
      },
    ],
  });
  return guardCancel(file);
}

/**
 * Prompts the user to choose between `.env` and `.env.local` in the cwd.
 * Used by `config local` where global is not an option.
 */
export async function promptSelectLocalFile(): Promise<string> {
  const file = await p.select<string>({
    message: 'Which local config file do you want to create/update?',
    options: [
      {
        value: path.resolve('.env'),
        label: '.env',
        hint: 'project defaults — commit this',
      },
      {
        value: path.resolve('.env.local'),
        label: '.env.local',
        hint: 'local overrides — do NOT commit',
      },
    ],
  });
  return guardCancel(file);
}

/**
 * Prompts the user to choose a single config key to update.
 * `currentValues` is shown as hints so the user can see what's set.
 * Resolves to the chosen key string (e.g. 'GEET_BRANCH_PREFIX').
 */
export async function promptSelectConfigKey(
  currentValues: Record<string, string> = {},
): Promise<string> {
  const key = await p.select<string>({
    message: 'Which setting do you want to update?',
    options: CONFIG_KEYS.map(({ key: k, label }) => ({
      value: k,
      label,
      hint: currentValues[k] ? `current: ${currentValues[k]}` : '(not set)',
    })),
  });
  return guardCancel(key);
}

/**
 * Prompts for an optional init-script source file path.
 * An empty value means "generate a stub template".
 */
export async function promptInitScriptSource(): Promise<string> {
  const src = await p.text({
    message: 'Path to an existing script to copy/move (leave empty to generate a stub):',
    placeholder: '~/scripts/my-init.sh',
  });
  return guardCancel<string | undefined>(src) ?? '';
}

/**
 * When an init script already exists, ask what to do.
 */
export async function promptOverrideOrSkip(): Promise<'edit' | 'override' | 'skip'> {
  const action = await p.select<'edit' | 'override' | 'skip'>({
    message: 'An init script already exists for this repo. What should we do?',
    options: [
      { value: 'edit', label: 'Edit', hint: 'open the existing script in $EDITOR' },
      { value: 'override', label: 'Override', hint: 'replace the existing script' },
      { value: 'skip', label: 'Skip', hint: 'leave the existing script unchanged' },
    ],
  });
  return guardCancel(action);
}

/**
 * When a source file is provided, ask whether to copy or move it.
 */
export async function promptCopyOrMove(): Promise<'copy' | 'move'> {
  const action = await p.select<'copy' | 'move'>({
    message: 'Copy or move the source file into ~/.geet/init/?',
    options: [
      { value: 'copy', label: 'Copy', hint: 'keep the original in place' },
      { value: 'move', label: 'Move', hint: 'remove the original after copying' },
    ],
  });
  return guardCancel(action);
}

/**
 * Prompts for the new value of a single config key, pre-filled with its current value.
 */
export async function promptConfigValue(meta: ConfigKey, current = ''): Promise<string> {
  const value = guardCancel(
    await p.text({
      message: `New value for ${meta.label}:`,
      placeholder: meta.placeholder,
      initialValue: current,
    }),
  );
  return value?.trim() ?? '';
}

/**
 * Prompts for the project name mapped to a repo. Empty means "clear the mapping".
 */
export async function promptProjectMapName(repoName: string, current = ''): Promise<string> {
  const name = guardCancel(
    await p.text({
      message: `Project name for "${repoName}" (leave empty to clear):`,
      placeholder: 'my-project',
      initialValue: current,
    }),
  );
  return name?.trim() ?? '';
}

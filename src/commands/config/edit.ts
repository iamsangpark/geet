/**
 * commands/config/edit.ts
 * Implements:
 *   geet config global   — interactively create/update ~/.geet/config
 *   geet config local    — create/update .env or .env.local in the cwd
 *   geet config set      — update a single key in a chosen file
 */

import path from 'path';
import { GLOBAL_CONFIG_PATH, CONFIG_KEYS, readEnvFile, writeEnvValues } from '../../config.ts';
import { GeetError } from '../../utils/errors.ts';
import { intro, outro, logInfo, logWarn, spinner } from '../../prompts/common.ts';
import {
  promptConfigValue,
  promptConfigValues,
  promptSelectConfigFile,
  promptSelectConfigKey,
  promptSelectLocalFile,
} from '../../prompts/config.ts';

interface EditMessages {
  reading: string;
  loaded: string;
  written: string;
}

/**
 * Shared flow for `global` and `local`: read the file, prompt for every config key
 * (pre-filled with existing values), then write back whatever was entered.
 */
async function editEnvFile(filePath: string, messages: EditMessages) {
  const s = spinner();
  s.start(messages.reading);
  const current = await readEnvFile(filePath);
  s.stop(messages.loaded);

  if (Object.keys(current).length > 0) {
    logInfo('Existing values are pre-filled — press Enter to keep, or type a new value.');
  }

  const values = await promptConfigValues(current);

  if (Object.keys(values).length === 0) {
    logWarn('No values entered — nothing written.');
    outro('Done.');
    return;
  }

  const s2 = spinner();
  s2.start(`Writing to ${filePath}...`);
  await writeEnvValues(filePath, values);
  s2.stop(messages.written);

  outro(`Saved: ${filePath}`);
}

/**
 * Interactively create or update ~/.geet/config.
 * Existing values are pre-filled so users only need to change what they want.
 */
export async function configGlobalAction() {
  intro('geet config global');
  await editEnvFile(GLOBAL_CONFIG_PATH, {
    reading: 'Reading current global config...',
    loaded: 'Current config loaded.',
    written: 'Global config updated.',
  });
}

/**
 * Create or update .env or .env.local in the current working directory.
 */
export async function configLocalAction() {
  intro('geet config local');
  const filePath = await promptSelectLocalFile();
  await editEnvFile(filePath, {
    reading: `Reading ${path.basename(filePath)}...`,
    loaded: 'Current values loaded.',
    written: 'Config written.',
  });
}

/**
 * Update a single config key in a file of the user's choosing.
 */
export async function configSetAction() {
  intro('geet config set');

  const filePath = await promptSelectConfigFile();

  const s = spinner();
  s.start(`Reading ${path.basename(filePath)}...`);
  const current = await readEnvFile(filePath);
  s.stop('File read.');

  const key = await promptSelectConfigKey(current);

  const meta = CONFIG_KEYS.find((k) => k.key === key);
  if (!meta) throw new GeetError(`Unknown config key: ${key}`);
  const newValue = await promptConfigValue(meta, current[key]);

  if (!newValue) {
    logWarn('Empty value — nothing written.');
    outro('Done.');
    return;
  }

  const s2 = spinner();
  s2.start(`Updating ${key} in ${path.basename(filePath)}...`);
  await writeEnvValues(filePath, { [key]: newValue });
  s2.stop('Value updated.');

  outro(`${key}=${newValue} → ${filePath}`);
}

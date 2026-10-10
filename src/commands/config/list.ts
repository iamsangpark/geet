/**
 * commands/config/list.ts
 * Implements `geet config list [--all]` — list config values currently set
 * (--all: every key + global values).
 */

import path from 'path';
import { GLOBAL_CONFIG_PATH, CONFIG_KEYS, readEnvFile } from '../../config.ts';

/**
 * List config options.
 * Default: keys with an effective value, annotated with where it comes from.
 * --all:   every known key (set or not) from the local files, followed by the
 *          values set in the global ~/.geet/config.
 */
export async function configListAction(options: { all?: boolean }) {
  const load = async (label: string, filePath: string) => ({
    label,
    path: filePath,
    values: await readEnvFile(filePath),
  });
  const local = await load('LOCAL', path.resolve('.env.local'));
  const repo = await load('REPO', path.resolve('.env'));
  const global = await load('GLOBAL', GLOBAL_CONFIG_PATH);

  // Effective value comes from process.env (shell wins, then LOCAL > REPO > GLOBAL).
  // Attribute it to the highest-priority file holding that value, else the shell.
  const effectiveSource = (key: string) => {
    const hit = [local, repo, global].find((src) => src.values[key] === process.env[key]);
    return hit ? hit.label : 'ENV';
  };

  const width = Math.max(...CONFIG_KEYS.map((k) => k.key.length));
  const line = (key: string, value: string | undefined, source?: string) =>
    `  ${key.padEnd(width)}  ${value === undefined ? '(not set)' : value}${source ? `  [${source}]` : ''}`;

  if (!options.all) {
    const set = CONFIG_KEYS.filter(({ key }) => process.env[key] !== undefined);
    if (set.length === 0) {
      console.log('No config values set. Use "geet config list --all" to see all options.');
      return;
    }
    for (const { key } of set) console.log(line(key, process.env[key], effectiveSource(key)));
    return;
  }

  const sections = [
    [local, '.env.local'],
    [repo, '.env'],
    [global, '~/.geet/config'],
  ] as const;
  sections.forEach(([src, file], i) => {
    if (i > 0) console.log();
    console.log(`${src.label} (${file}):`);
    for (const { key } of CONFIG_KEYS) console.log(line(key, src.values[key]));
  });
}

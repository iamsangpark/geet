import { logSuccess } from '../prompts.ts';

/**
 * Writes `value` to the system clipboard and reports it.
 * clipboardy is loaded lazily so commands that never copy don't pay for it at startup.
 */
export async function copyToClipboard(value: string, label = 'Copied to clipboard') {
  const { default: clipboard } = await import('clipboardy');
  await clipboard.write(value);
  logSuccess(`${label}: ${value}`);
}

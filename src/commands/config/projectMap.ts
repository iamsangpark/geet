/**
 * commands/config/projectMap.ts
 * Implements `geet config project-map` — set the project name for this repo.
 */

import { GLOBAL_PROJECT_MAP_PATH, readProjectMap, writeProjectMap } from '../../config.ts';
import { GeetError, errorMessage } from '../../utils/errors.ts';
import { getRepoName } from '../../utils/git.ts';
import { intro, outro, logInfo, logWarn, logSuccess, spinner } from '../../prompts/common.ts';
import { promptProjectMapName } from '../../prompts/config.ts';

/**
 * Set (or clear) the project name mapping for the current repo.
 * The mapping is stored in ~/.geet/project-map.json and used by `worktree add`
 * to skip the project name prompt.
 */
export async function configProjectMapAction() {
  intro('geet config project-map');

  const s = spinner();
  s.start('Detecting repo name...');
  let repoName: string;
  try {
    repoName = await getRepoName();
  } catch (err) {
    s.stop('');
    throw new GeetError(`Failed to detect repo name: ${errorMessage(err)}`);
  }
  s.stop(`Repo: ${repoName}`);

  const map = await readProjectMap();
  const current = map[repoName] ?? '';

  if (current) {
    logInfo(`Current mapping: ${repoName} → ${current}`);
  }

  const trimmedName = await promptProjectMapName(repoName, current);
  if (!trimmedName) {
    delete map[repoName];
    await writeProjectMap(map);
    logWarn(`Cleared project mapping for "${repoName}".`);
  } else {
    map[repoName] = trimmedName;
    await writeProjectMap(map);
    logSuccess(`Mapped: ${repoName} → ${trimmedName}`);
  }

  outro(`Saved: ${GLOBAL_PROJECT_MAP_PATH}`);
}

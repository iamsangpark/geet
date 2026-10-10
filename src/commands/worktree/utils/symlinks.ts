import path from 'path';
import { symlink, mkdir, access, unlink } from 'fs/promises';
import { constants } from 'fs';
import { errorCode, errorMessage } from '../../../utils/errors.ts';
import { logWarn, logError, logSuccess } from '../../../prompts/common.ts';

/**
 * Symlinks each relative path from sourceRoot into targetRoot.
 * Paths missing at the source are skipped. Existing destinations are skipped,
 * unless `replace` is set, in which case they are removed and re-linked.
 */
export async function linkPaths(
  sourceRoot: string,
  targetRoot: string,
  relativePaths: string[],
  { replace = false }: { replace?: boolean } = {},
) {
  for (const relPath of relativePaths) {
    const src = path.join(sourceRoot, relPath);
    const dest = path.join(targetRoot, relPath);

    try {
      await access(src, constants.F_OK);
    } catch {
      logWarn(`Skipped (source does not exist): ${relPath}`);
      continue;
    }

    await mkdir(path.dirname(dest), { recursive: true });

    if (replace) {
      try {
        await unlink(dest);
      } catch (err) {
        if (errorCode(err) !== 'ENOENT') {
          logError(`Failed to remove existing ${relPath}: ${errorMessage(err)}`);
          continue;
        }
      }
    }

    try {
      await symlink(src, dest);
      logSuccess(`Symlinked: ${relPath}`);
    } catch (err) {
      if (errorCode(err) === 'EEXIST') {
        logWarn(`Skipped (already exists): ${relPath}`);
      } else {
        logError(`Failed to symlink ${relPath}: ${errorMessage(err)}`);
      }
    }
  }
}

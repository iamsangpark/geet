/**
 * commands/stash.js
 * Implements:
 *   ga stash [message]      — stash with optional message
 *   ga stash pop            — pop with uncommitted-change guard
 *   ga stash list-pop       — interactive stash picker with guard
 */

import {
  getUncommittedChanges,
  stashSave,
  stashPop,
  stashPopIndex,
  listStashes,
  gitAddAll,
} from '../gitUtils.js';

import {
  intro,
  outro,
  logInfo,
  logWarn,
  spinner,
  promptUncommittedChangesForPop,
  promptSelectStash,
  promptStashMessage,
} from '../prompts.js';

// ── Shared: uncommitted-change guard before popping ───────────────────────────

async function guardBeforePop() {
  const changes = await getUncommittedChanges();
  if (changes) {
    logWarn(`Uncommitted changes detected:\n${changes}`);
    const action = await promptUncommittedChangesForPop();
    if (action === 'add-and-stash') {
      const s = spinner();
      s.start('Staging all untracked files and stashing...');
      await gitAddAll();
      await stashSave();
      s.stop('All changes staged and stashed.');
    } else if (action === 'stash-first') {
      const s = spinner();
      s.start('Stashing current changes...');
      await stashSave();
      s.stop('Current changes stashed.');
    }
    // 'pop-anyway' — fall through and pop
  }
}

// ── stash ─────────────────────────────────────────────────────────────────────

export async function stashAction(options) {
  intro('geet stash');

  // Use -m flag if provided, otherwise prompt (empty = no message)
  const message = options.message ?? (await promptStashMessage());

  const s = spinner();
  s.start(message ? `Stashing with message: "${message}"...` : 'Stashing changes...');
  if (!options.keepUntracked) {
    await gitAddAll();
  }
  await stashSave(message || undefined);
  s.stop('Changes stashed.');

  outro('Done.');
}

// ── stash pop ─────────────────────────────────────────────────────────────────

export async function stashPopAction(_options) {
  intro('geet sts pop');

  await guardBeforePop();

  const s = spinner();
  s.start('Popping stash...');
  await stashPop();
  s.stop('Stash applied and removed.');

  outro('Done.');
}

// ── stash list-pop ────────────────────────────────────────────────────────────

export async function stashListPopAction(_options) {
  intro('geet stash list');

  const s = spinner();
  s.start('Loading stashes...');
  const stashes = await listStashes();
  s.stop(`${stashes.length} stash(es) found.`);

  if (stashes.length === 0) {
    logInfo('No stashes found. Nothing to pop.');
    outro('Done.');
    return;
  }

  const selected = await promptSelectStash(stashes);

  await guardBeforePop();

  const s2 = spinner();
  s2.start(`Popping stash@{${selected.index}}...`);
  await stashPopIndex(selected.index);
  s2.stop(`stash@{${selected.index}} applied and removed.`);

  outro('Done.');
}

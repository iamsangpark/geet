import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clack/prompts', () => ({
  isCancel: (v: unknown) => typeof v === 'symbol',
  cancel: vi.fn(),
}));

import * as p from '@clack/prompts';
import { fuzzyMatch, guardCancel } from '../../src/prompts/common.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('guardCancel', () => {
  it('returns non-cancel values unchanged', () => {
    expect(guardCancel('value')).toBe('value');
    expect(guardCancel(0)).toBe(0);
  });

  it('prints the cancel message and exits 0 on the cancel symbol', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    expect(() => guardCancel(Symbol('clack:cancel'), 'Bye.')).toThrow('exit');
    expect(p.cancel).toHaveBeenCalledWith('Bye.');
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe('fuzzyMatch', () => {
  it('matches everything when there is no input', () => {
    expect(fuzzyMatch(undefined, 'anything')).toBe(true);
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });

  it('matches characters in order, ignoring case and gaps', () => {
    expect(fuzzyMatch('fl', 'fix-login')).toBe(true);
    expect(fuzzyMatch('FIXLOG', 'fix-login')).toBe(true);
    expect(fuzzyMatch('sp/pr', 'SP/PROJ-12 /wt/proj')).toBe(true);
  });

  it('rejects out-of-order or missing characters', () => {
    expect(fuzzyMatch('lf', 'fix-login')).toBe(false);
    expect(fuzzyMatch('xyz', 'fix-login')).toBe(false);
    expect(fuzzyMatch('fixx', 'fix')).toBe(false);
  });
});

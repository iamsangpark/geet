import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clack/prompts', () => ({
  isCancel: (v: unknown) => typeof v === 'symbol',
  cancel: vi.fn(),
}));

import * as p from '@clack/prompts';
import { guardCancel } from '../src/prompts.ts';

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

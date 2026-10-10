import { describe, expect, it } from 'vitest';
import { findJiraKey } from '../../src/commands/copy.ts';

describe('findJiraKey', () => {
  it.each([
    ['PROJ-1234', 'PROJ-1234'],
    ['sang/PROJ-1234-fix_login', 'PROJ-1234'],
    ['feature/AB2-7-thing', 'AB2-7'],
    ['PROJ-1-and-OTHER-2', 'PROJ-1'],
  ])('finds the first key in %j', (text, expected) => {
    expect(findJiraKey(text)).toBe(expected);
  });

  it.each(['main', 'proj-123', 'PROJ-', 'PROJ123'])('finds nothing in %j', (text) => {
    expect(findJiraKey(text)).toBeUndefined();
  });
});

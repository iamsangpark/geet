import { describe, expect, it } from 'vitest';
import { GeetError, errorCode, errorMessage, userMessage } from '../src/errors.ts';

describe('GeetError', () => {
  it('mirrors its message into gitMessage', () => {
    const err = new GeetError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('boom');
    expect(err.gitMessage).toBe('boom');
  });
});

describe('errorCode', () => {
  it('reads .code from error-like objects', () => {
    expect(errorCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT');
  });

  it('returns undefined for values without a code', () => {
    expect(errorCode(new Error('x'))).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode('ENOENT')).toBeUndefined();
  });
});

describe('errorMessage', () => {
  it('uses Error.message, else stringifies', () => {
    expect(errorMessage(new Error('nope'))).toBe('nope');
    expect(errorMessage('plain')).toBe('plain');
  });
});

describe('userMessage', () => {
  it('prefers gitMessage over message', () => {
    const err = Object.assign(new Error('raw'), { gitMessage: 'clean' });
    expect(userMessage(err)).toBe('clean');
    expect(userMessage(new GeetError('geet'))).toBe('geet');
  });

  it('falls back to message for ordinary errors', () => {
    expect(userMessage(new Error('raw'))).toBe('raw');
  });
});

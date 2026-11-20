import { describe, expect, it } from 'vitest';
import { scorerPath } from '../../src/client/lib/phoneCamera';

describe('DartLine phone-scoring links', () => {
  it('resumes the scorer without a new pairing code', () => {
    expect(scorerPath('')).toBe('/scorer');
  });
  it('pairs in a same-origin frame using the expected upstream query key', () => {
    expect(scorerPath('ABC234')).toBe('/scorer?code=ABC234');
  });
  it('rejects malformed or URL-injection pairing codes', () => {
    for (const value of ['AA', 'OOOOOO', '../scorer', 'ABC123#x', 'aBc234']) {
      expect(() => scorerPath(value)).toThrow('Invalid scorer pairing code');
    }
  });
});

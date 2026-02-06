import { normalizeName } from './artifacts';

describe('normalizeName', () => {
  it('trims whitespace', () => {
    expect(normalizeName('  foo bar  ')).toBe('foo bar');
  });

  it('replaces artifact-unsafe characters with hyphens', () => {
    expect(normalizeName('a"b:c<d>e|f*g?h\\i/j\r\nk')).toBe('a-b-c-d-e-f-g-h-i-j-k');
  });

  it('preserves allowed characters', () => {
    expect(normalizeName('foo_bar')).toBe('foo_bar');
    expect(normalizeName('foo.bar-baz')).toBe('foo.bar-baz');
  });
});

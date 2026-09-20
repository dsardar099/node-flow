import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './safe-return-to';

describe('safeReturnTo', () => {
  it('keeps a path on this site, query included', () => {
    expect(safeReturnTo('/execution/abc?tab=timeline')).toBe('/execution/abc?tab=timeline');
  });

  it.each([
    ['https://evil.example/login'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    [''],
    [undefined],
  ])('refuses %s', (value) => {
    expect(safeReturnTo(value)).toBe('/executions');
  });
});

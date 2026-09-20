import { describe, expect, it } from 'vitest';
import { MASKED_VALUE, maskFields } from './mask.js';

describe('maskFields', () => {
  const fields = new Set(['password', 'card']);

  it('masks a named key at any depth, in objects and arrays', () => {
    expect(
      maskFields(
        { user: 'ada', password: 'hunter2', payment: { card: { number: '4242' } }, attempts: [{ password: 'x' }, { ok: true }] },
        fields
      )
    ).toEqual({
      user: 'ada',
      password: MASKED_VALUE,
      payment: { card: MASKED_VALUE },
      attempts: [{ password: MASKED_VALUE }, { ok: true }],
    });
  });

  it('leaves null alone, and does not mutate the original', () => {
    const original = { password: null, nested: { card: '4242' } };
    expect(maskFields(original, fields)).toEqual({ password: null, nested: { card: MASKED_VALUE } });
    expect(original.nested.card).toBe('4242');
  });

  it('masks nothing, and returns the same value, without fields', () => {
    const value = { password: 'hunter2' };
    expect(maskFields(value, new Set())).toBe(value);
    expect(maskFields('password', fields)).toBe('password');
    expect(maskFields(undefined, fields)).toBeUndefined();
  });
});

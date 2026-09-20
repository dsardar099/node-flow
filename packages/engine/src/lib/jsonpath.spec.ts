import { ExpressionError, type JsonValue } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { resolveString, type ResolutionScope } from './expression.js';
import { compilePath, evaluatePath } from './jsonpath.js';

const order: JsonValue = {
  id: 'o-1',
  'shipping.method': 'express',
  items: [
    { sku: 'A', price: 5, tags: ['sale'] },
    { sku: 'B', price: 25, gift: true },
    { sku: 'C', price: 40 },
  ],
  customer: { name: 'Ada', address: { city: 'London' } },
};

const at = (path: string) => evaluatePath(order, compilePath(path));

describe('JSONPath', () => {
  it('reads definite paths as values', () => {
    expect(at('.id')).toBe('o-1');
    expect(at('.items[1].sku')).toBe('B');
    expect(at('.items[-1].price')).toBe(40);
    expect(at("['shipping.method']")).toBe('express');
    expect(at('.customer["address"].city')).toBe('London');
    expect(at('.items.0.sku')).toBe('A');
    expect(at('.items.length()')).toBe(3);
    expect(at('.items[9].sku')).toBeUndefined();
  });

  it('reads selecting paths as arrays, even of one', () => {
    expect(at('.items[*].sku')).toEqual(['A', 'B', 'C']);
    expect(at('.items.*.price')).toEqual([5, 25, 40]);
    expect(at('..city')).toEqual(['London']);
    expect(at('.items[0,2].sku')).toEqual(['A', 'C']);
    expect(at('.items[1:].sku')).toEqual(['B', 'C']);
    expect(at('.items[-2:].sku')).toEqual(['B', 'C']);
    expect(at('.items[?(@.price > 10)].sku')).toEqual(['B', 'C']);
    expect(at('.items[?(@.sku == "A")].price')).toEqual([5]);
    expect(at('.items[?(@.gift)].sku')).toEqual(['B']);
    expect(at('.items[?(@.price > 100)]')).toEqual([]);
  });

  it('refuses a malformed or script-like path instead of guessing', () => {
    expect(() => compilePath('.items[')).toThrow(ExpressionError);
    expect(() => compilePath('.items[?(@.price > process.exit())]')).toThrow(/is not a number, quoted string/);
    expect(() => compilePath('.items[foo]')).toThrow(/neither an index nor a quoted name/);
  });
});

describe('JSONPath in expressions', () => {
  const scope: ResolutionScope = {
    tasks: new Map([['cart', { input: {}, output: order as Record<string, JsonValue> }]]),
    workflow: { input: { lines: [{ qty: 2 }, { qty: 3 }] } },
    variables: { tiers: { gold: 10 } },
    env: { region: 'eu' },
  };

  it('resolves against every scope, keeping the value type', () => {
    expect(resolveString('${cart.output.items[?(@.price >= 25)].sku}', scope)).toEqual(['B', 'C']);
    expect(resolveString('${cart.output.items[0].price}', scope)).toBe(5);
    expect(resolveString('${workflow.input.lines[*].qty}', scope)).toEqual([2, 3]);
    expect(resolveString("${global['tiers'].gold}", scope)).toBe(10);
    expect(resolveString('${workflow.env["region"]}', scope)).toBe('eu');
    // Conductor's spelling for a workflow variable, in the path form.
    expect(resolveString("${workflow.variables['tiers'].gold}", scope)).toBe(10);
    expect(resolveString('first: ${cart.output.items[0].sku}', scope)).toBe('first: A');
  });

  it('still fails clearly for a task that has not run', () => {
    expect(() => resolveString('${nope.output.items[0]}', scope)).toThrow(/has not produced a result/);
  });
});

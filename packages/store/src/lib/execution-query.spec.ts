import { InvalidArgumentError } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { parseExecutionQuery } from './execution-query.js';

describe('the execution search box', () => {
  it('turns keys into filters and everything else into words', () => {
    expect(
      parseExecutionQuery('status:failed,timed-out wf:checkout_* version:v3 correlation:inv-7 key:order-42 is:top card declined')
    ).toEqual({
      status: ['FAILED', 'TIMED_OUT'],
      defNamePrefix: 'checkout_',
      defVersion: 3,
      correlationId: 'inv-7',
      idempotencyKey: 'order-42',
      subWorkflows: 'exclude',
      text: ['card', 'declined'],
    });
  });

  it('keeps quoted values whole, in keys and on their own', () => {
    expect(parseExecutionQuery('reason:"card \\"declined\\" twice" "exact phrase" workflow:checkout')).toEqual({
      reason: 'card "declined" twice',
      text: ['exact phrase'],
      defName: 'checkout',
    });
  });

  it('builds JSON containment from a path, trying both the typed value and the string', () => {
    const { contains } = parseExecutionQuery('input.customer.tier:gold output.total:42 output.approved:true input.note:"42"');
    expect(contains).toEqual([
      { field: 'input', alternatives: [{ customer: { tier: 'gold' } }] },
      { field: 'output', alternatives: [{ total: 42 }, { total: '42' }] },
      { field: 'output', alternatives: [{ approved: true }, { approved: 'true' }] },
      { field: 'input', alternatives: [{ note: '42' }] },
    ]);
    // JSON keys are case-sensitive, so the path keeps its case.
    expect(parseExecutionQuery('input.orderId:A-1').contains?.[0].alternatives).toEqual([{ orderId: 'A-1' }]);
  });

  it('reads a URL as text, not as a key', () => {
    expect(parseExecutionQuery('https://pay.example.com/x')).toEqual({ text: ['https://pay.example.com/x'] });
  });

  it('refuses what it cannot mean, naming what it can', () => {
    expect(() => parseExecutionQuery('state:FAILED')).toThrow(/"state:" is not a search key; use status/);
    expect(() => parseExecutionQuery('status:EXPLODED')).toThrow(/"EXPLODED" is not a status/);
    expect(() => parseExecutionQuery('version:latest')).toThrow(/not a version/);
    expect(() => parseExecutionQuery('is:weird')).toThrow(/is:sub, is:top/);
    expect(() => parseExecutionQuery('input..x:1')).toThrow(/not a valid path/);
    expect(() => parseExecutionQuery('status:')).toThrow(InvalidArgumentError);
    expect(() => parseExecutionQuery(Array.from({ length: 21 }, (_, i) => `w${i}`).join(' '))).toThrow(/at most 20/);
    expect(parseExecutionQuery('   ')).toEqual({});
  });
});

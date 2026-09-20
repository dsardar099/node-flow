import { simulate } from '@node-flow-dev/testkit';
import { describe, expect, it } from 'vitest';
import { compensation, expr, workflow } from './builder.js';

/**
 * The builder is only useful if what it builds runs as intended, so beyond
 * checking the JSON, each definition here is run through the real engine in
 * testkit's simulator.
 */

interface Order {
  orderId: string;
  amount: number;
  tier: 'gold' | 'standard';
  lines: { sku: string; qty: number }[];
}

describe('workflow builder', () => {
  it('compiles typed references into ${...} expressions', () => {
    const flow = workflow<Order>('checkout', { version: 3, description: 'Takes payment and ships' });
    const charge = flow.simple<{ txnId: string; card: { last4: string } }>('charge', {
      taskDef: 'charge_payment',
      input: { amount: flow.input.amount, firstSku: flow.input.lines[0].sku, lineCount: flow.input.lines.length },
      retryCount: 2,
    });
    flow.simple('ship', { input: { txn: charge.output.txnId, note: expr`Order ${flow.input.orderId} paid with ${charge.output.card.last4}` } });
    flow.output({ receipt: charge.output.txnId });

    const definition = flow.build();
    expect(definition).toMatchObject({
      name: 'checkout',
      version: 3,
      outputParameters: { receipt: '${charge.output.txnId}' },
      tasks: [
        {
          name: 'charge_payment',
          taskReferenceName: 'charge',
          type: 'SIMPLE',
          retryCount: 2,
          inputParameters: {
            amount: '${workflow.input.amount}',
            firstSku: '${workflow.input.lines[0].sku}',
            lineCount: '${workflow.input.lines.length()}',
          },
        },
        {
          taskReferenceName: 'ship',
          inputParameters: { txn: '${charge.output.txnId}', note: 'Order ${workflow.input.orderId} paid with ${charge.output.card.last4}' },
        },
      ],
    });
  });

  it('rejects references the types do not declare, at compile time', () => {
    const flow = workflow<Order>('typed');
    const charge = flow.simple<{ txnId: string }>('charge');
    // These lines are the test: the spec typecheck fails if any of them compiles.
    // @ts-expect-error — no such input field
    flow.simple('a', { input: { x: flow.input.amountt } });
    // @ts-expect-error — no such output field
    flow.simple('b', { input: { x: charge.output.txnid } });
    // @ts-expect-error — a typed input must match its declared type
    flow.simple<unknown, { amount: number }>('c', { input: { amount: flow.input.orderId } });
    expect(flow.tasks).toHaveLength(4);
  });

  it('refuses a reused reference name', () => {
    const flow = workflow('dupes');
    flow.simple('step');
    expect(() => flow.simple('step')).toThrow(/already used/);
    expect(() => flow.simple('bad name')).toThrow(/not a usable reference name/);
  });

  it('builds a switch, a fork and a loop that run as written', async () => {
    const flow = workflow<Order>('fulfil');
    flow.switch('route', {
      on: flow.input.tier,
      cases: { gold: (b) => void b.simple('concierge') },
      otherwise: (b) => void b.simple('standard_pick'),
    });
    const packed = flow.fork('pack', [(b) => void b.simple('box'), (b) => void b.simple('label')]);
    flow.loop('notify', { times: 2, body: (body, loop) => void body.simple('ping', { input: { attempt: loop.output.iteration } }) });
    flow.output({ label: packed.output.label });

    const result = await simulate(flow.build(), {
      input: { tier: 'gold' },
      mocks: { label: { output: { code: 'LBL-1' } } },
    });

    expect(result.status).toBe('COMPLETED');
    const ran = result.tasks.filter((t) => t.status === 'COMPLETED').map((t) => t.refName);
    expect(ran).toEqual(expect.arrayContaining(['concierge', 'box', 'label', 'pack_join', 'ping']));
    expect(ran).not.toContain('standard_pick');
    expect(result.tasks.filter((t) => t.refName === 'ping')).toHaveLength(2);
    expect(result.output).toEqual({ label: { code: 'LBL-1' } });
  });

  it('declares saga compensation that runs when the workflow fails', async () => {
    const flow = workflow('booking');
    const flight = flow.simple<{ booking: string }>('book_flight', {
      compensateWith: compensation((c) => void c.simple('cancel_flight', { input: { booking: '${book_flight.output.booking}' } })),
    });
    flow.simple('book_hotel', { compensateWith: 'cancel_hotel' });
    flow.terminate('stop', { status: 'FAILED', reason: 'no cars' });

    const result = await simulate(flow.build(), { mocks: { book_flight: { output: { booking: 'FL-1' } } } });

    expect(flight.ref).toBe('book_flight');
    expect(result.status).toBe('FAILED');
    expect(result.reasonForIncompletion).toBe('no cars (compensated: book_hotel, book_flight)');
    expect(result.tasks.find((t) => t.refName === 'cancel_flight')?.input).toEqual({ booking: 'FL-1' });
  });
});

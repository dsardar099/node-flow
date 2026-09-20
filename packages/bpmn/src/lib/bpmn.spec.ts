import { describe, expect, it } from 'vitest';
import { importBpmn, sanitiseName } from './bpmn.js';

/**
 * BPMN import, tested on the difference between a graph and a tree.
 *
 * The happy cases matter, but the ones that decide whether this feature is
 * useful or dangerous are the others: a loop, an unmatched gateway, an element
 * nothing reaches. Each must produce a warning naming the element, because a
 * quietly approximated process is worse than a refused one — it looks right in
 * a diagram and takes a different path in production.
 */

/** A minimal process: start → two tasks → end. */
const sequential = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="Order" name="Order fulfilment" isExecutable="true">
    <bpmn:startEvent id="start"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="charge" name="Charge card" />
    <bpmn:userTask id="review" name="Review order" />
    <bpmn:endEvent id="end" />
    <bpmn:sequenceFlow id="f1" sourceRef="start" targetRef="charge" />
    <bpmn:sequenceFlow id="f2" sourceRef="charge" targetRef="review" />
    <bpmn:sequenceFlow id="f3" sourceRef="review" targetRef="end" />
  </bpmn:process>
</bpmn:definitions>`;

const withGateways = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="Claim" name="Claim handling">
    <startEvent id="start" />
    <exclusiveGateway id="split" name="Large claim?" default="f_small" />
    <serviceTask id="assess" name="Manual assessment" />
    <serviceTask id="auto" name="Auto approve" />
    <exclusiveGateway id="merge" />
    <parallelGateway id="fork" name="Notify" />
    <serviceTask id="email" name="Send email" />
    <serviceTask id="sms" name="Send SMS" />
    <parallelGateway id="joined" />
    <serviceTask id="archive" name="Archive claim" />
    <endEvent id="end" />
    <sequenceFlow id="f0" sourceRef="start" targetRef="split" />
    <sequenceFlow id="f_large" name="large" sourceRef="split" targetRef="assess">
      <conditionExpression>\${amount &gt; 1000}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f_small" sourceRef="split" targetRef="auto" />
    <sequenceFlow id="f1" sourceRef="assess" targetRef="merge" />
    <sequenceFlow id="f2" sourceRef="auto" targetRef="merge" />
    <sequenceFlow id="f3" sourceRef="merge" targetRef="fork" />
    <sequenceFlow id="f4" sourceRef="fork" targetRef="email" />
    <sequenceFlow id="f5" sourceRef="fork" targetRef="sms" />
    <sequenceFlow id="f6" sourceRef="email" targetRef="joined" />
    <sequenceFlow id="f7" sourceRef="sms" targetRef="joined" />
    <sequenceFlow id="f8" sourceRef="joined" targetRef="archive" />
    <sequenceFlow id="f9" sourceRef="archive" targetRef="end" />
  </process>
</definitions>`;

describe('importing a BPMN process', () => {
  it('converts a straight-through process, naming tasks after the BPMN labels', () => {
    const { definition, warnings, source } = importBpmn(sequential);

    expect(source).toEqual({ processId: 'Order', processName: 'Order fulfilment' });
    expect(definition['name']).toBe('order_fulfilment');
    expect(definition['tasks']).toEqual([
      { name: 'charge_card', taskReferenceName: 'charge_card', type: 'SIMPLE' },
      { name: 'review_order', taskReferenceName: 'review_order', type: 'HUMAN', inputParameters: { assignee: '' } },
    ]);
    // Start and end events are structure, not work.
    expect(warnings).toEqual([]);
  });

  it('nests an exclusive gateway as a SWITCH and a parallel one as FORK_JOIN', () => {
    const { definition, warnings } = importBpmn(withGateways);
    const tasks = definition['tasks'] as Record<string, unknown>[];

    const decision = tasks[0] as { type: string; decisionCases: Record<string, unknown[]>; defaultCase: unknown[] };
    expect(decision.type).toBe('SWITCH');
    expect(Object.keys(decision.decisionCases)).toEqual(['large']);
    expect(decision.decisionCases['large']).toEqual([
      { name: 'manual_assessment', taskReferenceName: 'manual_assessment', type: 'SIMPLE' },
    ]);
    // The flow marked `default` is the default branch, not a case.
    expect(decision.defaultCase).toEqual([{ name: 'auto_approve', taskReferenceName: 'auto_approve', type: 'SIMPLE' }]);

    const fork = tasks[1] as { type: string; forkTasks: unknown[][] };
    const join = tasks[2] as { type: string; joinOn: string[] };
    expect(fork.type).toBe('FORK_JOIN');
    expect(fork.forkTasks.map((branch) => (branch[0] as { taskReferenceName: string }).taskReferenceName)).toEqual([
      'send_email',
      'send_sms',
    ]);
    expect(join).toMatchObject({ type: 'JOIN', joinOn: ['send_email', 'send_sms'] });

    // Everything after the join continues at the top level.
    expect(tasks[3]).toMatchObject({ taskReferenceName: 'archive_claim' });

    // The BPMN condition cannot be evaluated by node-flow, and the import says
    // so rather than producing a switch that silently always defaults.
    expect(warnings.some((w) => w.includes('caseValueParam'))).toBe(true);
  });

  it('reads any namespace prefix, because every modeller picks a different one', () => {
    const prefixed = sequential.replace(/bpmn:/g, 'bpmn2:').replace('xmlns:bpmn=', 'xmlns:bpmn2=');
    expect((importBpmn(prefixed).definition['tasks'] as unknown[]).length).toBe(2);
  });

  it('reports a loop instead of inventing a DO_WHILE', () => {
    const looping = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
      <process id="Retry">
        <startEvent id="start" />
        <serviceTask id="try" name="Attempt" />
        <serviceTask id="check" name="Check" />
        <sequenceFlow id="f1" sourceRef="start" targetRef="try" />
        <sequenceFlow id="f2" sourceRef="try" targetRef="check" />
        <sequenceFlow id="f3" sourceRef="check" targetRef="try" />
      </process>
    </definitions>`;

    const { definition, warnings } = importBpmn(looping);
    expect((definition['tasks'] as unknown[]).length).toBe(2);
    expect(warnings.some((w) => /loops back to "Attempt"/.test(w))).toBe(true);
  });

  it('names what it could not map, rather than dropping it', () => {
    const exotic = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
      <process id="Mixed">
        <startEvent id="start" />
        <scriptTask id="calc" name="Compute total"><script>total = price * qty</script></scriptTask>
        <callActivity id="child" name="Run credit check" calledElement="credit_check" />
        <intermediateCatchEvent id="pause" name="Wait a day"><timerEventDefinition /></intermediateCatchEvent>
        <transaction id="tx" name="Booking transaction" />
        <serviceTask id="orphan" name="Never reached" />
        <endEvent id="end"><terminateEventDefinition /></endEvent>
        <sequenceFlow id="f1" sourceRef="start" targetRef="calc" />
        <sequenceFlow id="f2" sourceRef="calc" targetRef="child" />
        <sequenceFlow id="f3" sourceRef="child" targetRef="pause" />
        <sequenceFlow id="f4" sourceRef="pause" targetRef="tx" />
        <sequenceFlow id="f5" sourceRef="tx" targetRef="end" />
      </process>
    </definitions>`;

    const { definition, warnings } = importBpmn(exotic);
    const tasks = definition['tasks'] as Record<string, unknown>[];

    expect(tasks.map((t) => t['type'])).toEqual(['INLINE', 'SUB_WORKFLOW', 'WAIT', 'NOOP', 'TERMINATE']);
    // The script is carried as data, never handed to a JavaScript sandbox that
    // would fail on Groovy with a message about syntax.
    expect((tasks[0]['inputParameters'] as { bpmnScript: string }).bpmnScript).toBe('total = price * qty');
    expect(tasks[1]['subWorkflowParam']).toEqual({ name: 'credit_check' });

    expect(warnings.some((w) => w.includes('script task'))).toBe(true);
    expect(warnings.some((w) => /"Booking transaction" is a transaction/.test(w))).toBe(true);
    expect(warnings.some((w) => /"Never reached".*not reachable/.test(w))).toBe(true);
  });

  it('refuses a document that is not BPMN at all', () => {
    expect(() => importBpmn('<html><body>hello</body></html>')).toThrow(/not a BPMN 2.0 document/);
    expect(() => importBpmn('<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"/>')).toThrow(/no <process>/);
  });

  it('imports the first of several processes and says which', () => {
    const two = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
      <process id="First"><startEvent id="s1" /><serviceTask id="a" name="A" />
        <sequenceFlow id="f" sourceRef="s1" targetRef="a" /></process>
      <process id="Second"><startEvent id="s2" /><serviceTask id="b" name="B" />
        <sequenceFlow id="g" sourceRef="s2" targetRef="b" /></process>
    </definitions>`;

    expect(importBpmn(two).warnings[0]).toMatch(/2 processes; imported "First"/);
    expect(importBpmn(two, { processId: 'Second' }).source.processId).toBe('Second');
  });
});

describe('reference names', () => {
  it('turns prose into an identifier', () => {
    expect(sanitiseName('Check stock levels!')).toBe('check_stock_levels');
    expect(sanitiseName('  ---  ')).toBe('');
  });
});

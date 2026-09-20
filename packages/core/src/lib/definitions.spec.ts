import { describe, expect, it } from 'vitest';
import { workflowDefinitionSchema, workflowTaskSchema } from './definitions.js';
import { RetryLogic } from './policies.js';
import { TaskType } from './task-type.js';

/**
 * Fields an author writes must survive parsing.
 *
 * zod drops unknown keys rather than rejecting them, which is a good default
 * for a wire format and a bad one for a *specification*: a task carrying
 * `retryLogic: 'FIXED'` parsed cleanly, lost the field, and ran on exponential
 * backoff. No error at registration, nothing in the stored definition, nothing
 * at runtime — the only evidence was retries arriving at the wrong times.
 *
 * That went unnoticed long enough for this project's own end-to-end suite to
 * write those fields in two places and pass while asserting nothing about
 * them. So these assert the round trip, which is the property that was
 * actually missing.
 */

const base = {
  name: 'charge',
  taskReferenceName: 'charge',
  type: TaskType.SIMPLE,
};

describe('workflowTaskSchema', () => {
  it('keeps every retry override', () => {
    const parsed = workflowTaskSchema.parse({
      ...base,
      retryCount: 5,
      retryLogic: RetryLogic.FIXED,
      retryDelaySeconds: 7,
      backoffScaleFactor: 3,
      maxRetryDelaySeconds: 60,
      jitter: 0.5,
    });

    expect(parsed).toMatchObject({
      retryCount: 5,
      retryLogic: RetryLogic.FIXED,
      retryDelaySeconds: 7,
      backoffScaleFactor: 3,
      maxRetryDelaySeconds: 60,
      jitter: 0.5,
    });
  });

  it('leaves retry overrides absent when they are not given', () => {
    // Absent must stay absent rather than becoming a default, because
    // `undefined` is what defers to the task definition.
    const parsed = workflowTaskSchema.parse(base);

    expect(parsed.retryLogic).toBeUndefined();
    expect(parsed.retryDelaySeconds).toBeUndefined();
  });

  it('still rejects a value outside the policy bounds', () => {
    // Accepting the fields must not mean accepting nonsense: a scale factor
    // below 1 shrinks the delay on every attempt.
    expect(() =>
      workflowTaskSchema.parse({ ...base, backoffScaleFactor: 0.5 })
    ).toThrow();
    expect(() => workflowTaskSchema.parse({ ...base, jitter: 2 })).toThrow();
  });

  it('carries the overrides through a whole definition', () => {
    const definition = workflowDefinitionSchema.parse({
      name: 'fulfil',
      version: 1,
      tasks: [{ ...base, retryLogic: RetryLogic.LINEAR_BACKOFF, retryDelaySeconds: 2 }],
    });

    expect(definition.tasks[0]).toMatchObject({
      retryLogic: RetryLogic.LINEAR_BACKOFF,
      retryDelaySeconds: 2,
    });
  });
});

/**
 * Shapes Conductor's own SDK emits that are not obviously valid.
 *
 * These are not hypothetical: each one arrived from
 * `@io-orkes/conductor-javascript`'s `ConductorWorkflow.toWorkflowDef()` and was
 * refused. The compatibility suite did not catch them because its definitions
 * are written by hand, so they never carried the fields the builder always sets.
 */
describe('Conductor SDK output', () => {
  it('treats an empty failureWorkflow as none', () => {
    // The builder initialises it to "" and emits it whether or not it was set.
    const parsed = workflowDefinitionSchema.parse({
      name: 'from_builder',
      version: 1,
      failureWorkflow: '',
      tasks: [{ ...base }],
    });

    expect(parsed.failureWorkflow).toBeUndefined();
  });

  it('still rejects a failure workflow that is set but unusable', () => {
    // Empty means "none"; a name with a space is a mistake, and staying silent
    // about it would mean a failure workflow that never runs.
    expect(() =>
      workflowDefinitionSchema.parse({
        name: 'from_builder',
        version: 1,
        failureWorkflow: 'not a valid name',
        tasks: [{ ...base }],
      })
    ).toThrow();
  });

  it('keeps a real failure workflow', () => {
    const parsed = workflowDefinitionSchema.parse({
      name: 'from_builder',
      version: 1,
      failureWorkflow: 'on_failure',
      tasks: [{ ...base }],
    });

    expect(parsed.failureWorkflow).toBe('on_failure');
  });
});

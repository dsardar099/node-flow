import { WORKFLOW_TEMPLATES, templateById } from '@node-flow-dev/core';
import { describe, expect, it } from 'vitest';
import { checkDefinition } from './metadata.repository.js';

/**
 * Every shipped template compiles.
 *
 * A starter workflow that fails on save is worse than no starter at all: it
 * teaches the mistake, and the person who hits it has no way to tell whether
 * the example is wrong or they are. This runs the exact check registration
 * runs, so "ships" and "works" cannot drift apart.
 *
 * It lives in `store` rather than `core` because the compiler does — `core`
 * holds the DSL, and a template is data in that DSL.
 */
describe('workflow templates', () => {
  it.each(WORKFLOW_TEMPLATES.map((template) => [template.id, template] as const))(
    '"%s" compiles',
    (_id, template) => {
      const checked = checkDefinition(template.definition);
      // The issues are in the message so a failure says *what* is wrong rather
      // than only that something is.
      expect(checked.valid ? [] : checked.issues).toEqual([]);
      expect(checked.valid).toBe(true);
    }
  );

  it('gives each template a distinct id and something it teaches', () => {
    const ids = WORKFLOW_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.teaches.length, template.id).toBeGreaterThan(10);
      expect(template.summary.length, template.id).toBeGreaterThan(10);
      // The definition's name is what a new workflow starts as, so it has to be
      // a legal workflow name rather than prose.
      expect(template.definition.name, template.id).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    }
  });

  it('finds one by id, and answers undefined for a name nobody shipped', () => {
    expect(templateById(WORKFLOW_TEMPLATES[0].id)?.title).toBe(WORKFLOW_TEMPLATES[0].title);
    expect(templateById('does-not-exist')).toBeUndefined();
  });
});

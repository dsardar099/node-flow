import { ErrorCode, InvalidArgumentError, NodeFlowError, type JsonValue } from '@node-flow-dev/core';
import { sql } from 'kysely';
import type { Db, Queryable } from './database.js';
import { json } from './schema.js';

export interface FormTemplate {
  name: string;
  version: number;
  schema: Record<string, JsonValue>;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
}

/** How a HUMAN task names a template instead of carrying a form inline. */
export interface FormReference {
  template: string;
  version?: number;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,199}$/;
const COLUMNS = ['name', 'version', 'schema', 'description', 'createdBy', 'createdAt'] as const;

export function isFormReference(value: unknown): value is FormReference {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['template'] === 'string' &&
    Object.keys(record).every((key) => key === 'template' || (key === 'version' && Number.isInteger(record['version'])))
  );
}

/**
 * User forms: JSON Schemas that describe what a person fills in, with the
 * field order carried in `ui:order` (stored JSON does not keep key order).
 */
export class FormTemplateRepository {
  constructor(private readonly db: Db) {}

  async register(
    namespaceId: string,
    input: { name: string; schema: Record<string, JsonValue>; description?: string; createdBy?: string }
  ): Promise<FormTemplate> {
    if (!NAME.test(input.name)) throw new InvalidArgumentError(`"${input.name}" is not a valid form name`);
    const properties = input.schema['properties'];
    if (typeof properties !== 'object' || properties === null || Object.keys(properties).length === 0) {
      throw new InvalidArgumentError('a form needs at least one field');
    }

    return this.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${`${namespaceId}:form:${input.name}`}))`.execute(tx);
      const current = await tx
        .selectFrom('FormTemplates')
        .select((eb) => eb.fn.max('version').as('max'))
        .where('namespaceId', '=', namespaceId)
        .where('name', '=', input.name)
        .executeTakeFirst();
      const row = await tx
        .insertInto('FormTemplates')
        .values({
          namespaceId,
          name: input.name,
          version: Number(current?.max ?? 0) + 1,
          schema: json({ type: 'object', ...input.schema }),
          description: input.description ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning(COLUMNS)
        .executeTakeFirstOrThrow();
      return toTemplate(row);
    });
  }

  async list(namespaceId: string): Promise<(FormTemplate & { versions: number })[]> {
    const rows = await this.db
      .selectFrom('FormTemplates as f')
      .select(['f.name', 'f.version', 'f.schema', 'f.description', 'f.createdBy', 'f.createdAt'])
      .select((eb) =>
        eb
          .selectFrom('FormTemplates as c')
          .select((c) => c.fn.countAll<string>().as('n'))
          .whereRef('c.namespaceId', '=', 'f.namespaceId')
          .whereRef('c.name', '=', 'f.name')
          .as('versions')
      )
      .where('f.namespaceId', '=', namespaceId)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('FormTemplates as newer')
              .select('newer.version')
              .whereRef('newer.namespaceId', '=', 'f.namespaceId')
              .whereRef('newer.name', '=', 'f.name')
              .whereRef('newer.version', '>', 'f.version')
          )
        )
      )
      .orderBy('f.name')
      .execute();
    return rows.map((row) => ({ ...toTemplate(row), versions: Number(row.versions) }));
  }

  async get(namespaceId: string, name: string, version?: number, executor: Queryable = this.db): Promise<FormTemplate | undefined> {
    let query = executor.selectFrom('FormTemplates').select(COLUMNS).where('namespaceId', '=', namespaceId).where('name', '=', name);
    query = version === undefined ? query.orderBy('version', 'desc').limit(1) : query.where('version', '=', version);
    const row = await query.executeTakeFirst();
    return row ? toTemplate(row) : undefined;
  }

  async versions(namespaceId: string, name: string): Promise<FormTemplate[]> {
    const rows = await this.db
      .selectFrom('FormTemplates')
      .select(COLUMNS)
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .orderBy('version', 'desc')
      .execute();
    return rows.map(toTemplate);
  }

  async deleteVersion(namespaceId: string, name: string, version: number): Promise<boolean> {
    const result = await this.db
      .deleteFrom('FormTemplates')
      .where('namespaceId', '=', namespaceId)
      .where('name', '=', name)
      .where('version', '=', version)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  /** The template a reference names, or a NOT_FOUND naming it. */
  async require(namespaceId: string, reference: FormReference, executor: Queryable = this.db): Promise<FormTemplate> {
    const template = await this.get(namespaceId, reference.template, reference.version, executor);
    if (!template) {
      throw new NodeFlowError(
        ErrorCode.NOT_FOUND,
        `form "${reference.template}"${reference.version ? ` version ${reference.version}` : ''} does not exist`
      );
    }
    return template;
  }
}

function toTemplate(row: {
  name: string;
  version: number;
  schema: unknown;
  description: string | null;
  createdBy: string | null;
  createdAt: Date;
}): FormTemplate {
  return { ...row, schema: row.schema as Record<string, JsonValue> };
}

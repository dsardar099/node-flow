import type { JsonValue, TaskStatus, TaskType, WorkflowStatus } from '@node-flow-dev/core';
import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * The database schema, as types.
 *
 * This replaces the Sequelize models entirely. It is not an ORM layer — there
 * are no classes, no decorators and no runtime behaviour here at all, just the
 * shape of the tables so every query is checked at compile time.
 *
 * What that removes, beyond ~700 lines: the `useDefineForClassFields` trap, the
 * `@CreatedAt`-under-`timestamps:false` trap, client-side `allowNull` rejecting
 * database defaults, and the schema-drift test that existed purely to police
 * models against migrations. Drift is now a compile error rather than something
 * a test has to go looking for.
 *
 * **Naming still follows the same convention** — PascalCase plural tables,
 * camelCase columns — because that is what the migrations create. Every
 * identifier is quoted in the generated SQL, which is what Postgres requires
 * for anything that is not lowercase.
 */

/**
 * A JSONB column: reads as a value, writes as serialised JSON.
 *
 * The asymmetry is deliberate. Kysely cannot tell a plain object apart from an
 * expression, so accepting objects on write makes every insert infer as an
 * unassignable `ValueExpression`. Requiring a string instead makes
 * serialisation explicit at each call site — use the `json()` helper — and
 * matches what the driver sends for a jsonb parameter anyway.
 */
type Json<T = Record<string, JsonValue>> = ColumnType<T, string, string>;

/**
 * A JSONB column with a database default.
 *
 * Not `Generated<Json>`: `Generated` wraps a *value* type, and nesting it
 * around a ColumnType produces something Kysely cannot unwrap. Optionality
 * belongs inside the ColumnType's insert position.
 */
type JsonDefaulted<T = Record<string, JsonValue>> = ColumnType<T, string | undefined, string>;

/**
 * A nullable JSONB column.
 *
 * Not `Json | null`: a union of a ColumnType with null is opaque to Kysely, and
 * every write against it fails to infer as an unassignable `ValueExpression`.
 * The null has to live inside each position of the ColumnType.
 */
type NullableJson<T = Record<string, JsonValue>> = ColumnType<
  T | null,
  string | null | undefined,
  string | null
>;

/**
 * Serialises a value for a JSONB column.
 *
 * The NUL removal is not cosmetic. Postgres `jsonb` **cannot represent a
 * NUL inside a string** — it rejects the whole value with "unsupported Unicode
 * escape sequence" — while JSON, JavaScript and every HTTP response are
 * perfectly happy to carry one. So a task that calls an API returning a stray
 * NUL cannot store its own output: the insert throws, the task never reaches a
 * terminal state, and the run hangs with nothing visibly wrong. Found exactly
 * that way, against a public API whose test data contained one.
 *
 * Stripping rather than failing, because the alternative is worse in every
 * direction: the data is already in hand, the task did its work, and refusing
 * to record a result over one unprintable byte turns a successful call into a
 * stuck workflow. A NUL in the middle of text is never meaningful content —
 * it is a truncation marker or a fuzzer's leftover.
 *
 * Applied here because this is the single funnel every JSONB write passes
 * through; doing it at each call site would mean the next one forgets.
 */
export function json(value: unknown): string {
  const serialised = JSON.stringify(value ?? null);
  // Operates on the serialised form so it catches both a real NUL character
  // and the JSON escape for it that a nested string may already carry.
  return serialised.includes('\\u0000') ? serialised.replaceAll('\\u0000', '') : serialised;
}

/** Written by the database, never by us. */
type DbGenerated<T> = ColumnType<T, never, never>;

export interface NamespacesTable {
  id: Generated<string>;
  slug: string;
  settings: JsonDefaulted;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface WorkflowDefinitionsTable {
  namespaceId: string;
  name: string;
  /** Immutable once written — the blueprint cache keys on (name, version). */
  version: number;
  definition: Json;
  blueprint: Json;
  /** `key:value` tags. Tags restrict access; they never grant it. */
  tags: Generated<string[]>;
  createdAt: Generated<Date>;
  createdBy: string | null;
}

export interface TaskLogsTable {
  id: Generated<string>;
  namespaceId: string;
  workflowId: string;
  taskId: string;
  level: Generated<string>;
  message: string;
  at: Generated<Date>;
}

export interface FormTemplatesTable {
  namespaceId: string;
  name: string;
  version: number;
  schema: Json<JsonValue>;
  description: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
}

export interface SchemasTable {
  namespaceId: string;
  name: string;
  version: number;
  type: Generated<string>;
  data: Json<JsonValue>;
  description: string | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
}

export interface EnvironmentVariablesTable {
  namespaceId: string;
  name: string;
  type: Generated<string>;
  value: Json<JsonValue>;
  description: string | null;
  updatedBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface TaskOutputCacheTable {
  namespaceId: string;
  taskDefName: string;
  key: string;
  output: Json<JsonValue>;
  expiresAt: Date;
  storedAt: Generated<Date>;
}

export interface WorkerPollsTable {
  namespaceId: string;
  queueName: string;
  workerId: string;
  lastPollAt: Generated<Date>;
}

/** A provider a workflow may use by name: an LLM API or an MCP server. */
export interface IntegrationsTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  /** `LLM` or `MCP`. */
  kind: string;
  provider: string;
  description: string | null;
  baseUrl: string | null;
  /** The name of the secret holding the key, never the key. */
  apiKeySecret: string | null;
  models: string[];
  config: Json;
  enabled: Generated<boolean>;
  createdBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** One version of a prompt template. */
export interface PromptsTable {
  namespaceId: string;
  name: string;
  version: number;
  description: string | null;
  template: string;
  variables: string[];
  models: string[];
  createdBy: string | null;
  createdAt: Generated<Date>;
}

/** A chunk of text and its embedding, in a named index. */
export interface VectorDocumentsTable {
  id: Generated<string>;
  namespaceId: string;
  indexName: string;
  docId: string;
  chunk: number;
  text: string;
  metadata: Json;
  embedding: number[];
  dimensions: number;
  model: string | null;
  createdAt: Generated<Date>;
}

/** A subject's specific access to a resource. */
export interface ResourceGrantsTable {
  id: Generated<string>;
  namespaceId: string;
  /** `USER`, `GROUP` or `APPLICATION` (a service account or API key). */
  subjectType: string;
  subjectId: string;
  /** `WORKFLOW` or `TASK_DEFINITION`. */
  resourceType: string;
  resource: string;
  access: string[];
  createdBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** A named search someone saved, for themselves or the namespace. */
export interface SavedViewsTable {
  id: Generated<string>;
  namespaceId: string;
  /** Which screen it belongs to, e.g. `executions`. */
  page: string;
  ownerId: string;
  ownerName: string | null;
  name: string;
  state: JsonDefaulted;
  shared: Generated<boolean>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/** One firing of a schedule. */
export interface ScheduleRunsTable {
  id: Generated<string>;
  namespaceId: string;
  scheduleId: string;
  scheduledFor: Date;
  firedAt: Generated<Date>;
  /** `STARTED`, `SKIPPED` or `FAILED`. */
  outcome: string;
  workflowId: string | null;
  reason: string | null;
}

/** A change-data-capture subscription: which workflow lifecycle events go to which sink. */
export interface StatusListenersTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  description: string | null;
  enabled: Generated<boolean>;
  /** Workflow names, with a trailing `*` as a prefix match; empty means every workflow. */
  workflowNames: Generated<string[]>;
  /** Lifecycle events; empty means all of them. */
  events: Generated<string[]>;
  /** `WEBHOOK` or `KAFKA`. */
  sink: string;
  config: JsonDefaulted;
  includeOutput: Generated<boolean>;
  deliveredCount: Generated<string>;
  failedCount: Generated<string>;
  lastDeliveredAt: Date | null;
  lastFailedAt: Date | null;
  lastError: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface IncomingWebhooksTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  description: string | null;
  verifier: string;
  config: JsonDefaulted;
  secretName: string | null;
  enabled: Generated<boolean>;
  receivedCount: Generated<string>;
  rejectedCount: Generated<string>;
  lastReceivedAt: Date | null;
  lastError: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface WorkflowMessagesTable {
  id: Generated<string>;
  namespaceId: string;
  workflowId: string;
  payload: JsonDefaulted;
  receivedAt: Generated<Date>;
  consumedByTaskId: string | null;
  consumedAt: Date | null;
}

export type EventOutcome = 'ACTED' | 'SKIPPED' | 'FAILED';

export interface EventExecutionsTable {
  id: Generated<string>;
  namespaceId: string;
  handlerName: string;
  action: string;
  source: string;
  topic: string;
  messageKey: string | null;
  deliveryId: string;
  payload: JsonDefaulted;
  outcome: EventOutcome;
  workflowId: string | null;
  detail: string | null;
  at: Generated<Date>;
}

export interface TaskDefinitionsTable {
  namespaceId: string;
  name: string;
  description: string | null;
  // retry policy
  retryCount: Generated<number>;
  retryLogic: Generated<string>;
  retryDelaySeconds: Generated<number>;
  backoffScaleFactor: Generated<number>;
  maxRetryDelaySeconds: Generated<number>;
  jitter: Generated<number>;
  retryBudget: Generated<number>;
  nonRetryableErrors: JsonDefaulted<string[]>;
  // timeouts
  timeoutSeconds: Generated<number>;
  scheduleToStartTimeout: Generated<number>;
  startToCloseTimeout: Generated<number>;
  heartbeatTimeout: Generated<number>;
  responseTimeoutSeconds: Generated<number>;
  pollTimeoutSeconds: Generated<number>;
  timeoutPolicy: Generated<string>;
  // concurrency
  concurrentExecLimit: Generated<number>;
  rateLimitPerFrequency: Generated<number>;
  rateLimitFrequencySeconds: Generated<number>;
  semaphores: JsonDefaulted<string[]>;
  inputKeys: JsonDefaulted<string[]>;
  outputKeys: JsonDefaulted<string[]>;
  inputSchema: NullableJson;
  outputSchema: NullableJson;
  /** Output fields that are credentials, sealed on the way into storage. */
  secretOutputFields: Generated<string[]>;
  ownerEmail: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface WorkflowExecutionsTable {
  id: Generated<string>;
  namespaceId: string;
  defName: string;
  defVersion: number;
  status: WorkflowStatus;
  correlationId: string | null;
  idempotencyKey: string | null;
  priority: Generated<number>;
  input: NullableJson;
  /** Set instead of `input` when the payload was offloaded to blob storage. */
  inputRef: string | null;
  output: NullableJson;
  outputRef: string | null;
  variables: JsonDefaulted;
  parentWorkflowId: string | null;
  parentTaskId: string | null;
  reasonForIncompletion: string | null;
  startedAt: Generated<Date>;
  updatedAt: Generated<Date>;
  endedAt: Date | null;
  version: Generated<string>;
  rateLimitKey: Generated<string | null>;
  /** Worker routing for this run: task name or `*` to domain. */
  taskToDomain: NullableJson<Record<string, string>>;
  /** The W3C `traceparent` this run was started with, when it came from a traced request. */
  traceparent: ColumnType<string | null, string | null | undefined, string | null>;
  rateLimit: Generated<number | null>;
  admittedAt: Generated<Date | null>;
}

export interface TaskExecutionsTable {
  /** Worker pool this task was routed to. Null means the shared queue. */
  domain: string | null;
  id: Generated<string>;
  workflowId: string;
  namespaceId: string;
  /** Identifies the task within the workflow; what `${...}` expressions refer to. */
  refName: string;
  taskDefName: string;
  taskType: TaskType;
  status: TaskStatus;
  /** Part of task identity: a retry is a new row, not a collision. */
  attempt: Generated<number>;
  /** DO_WHILE pass number; 0 outside a loop. Also part of identity. */
  iteration: Generated<number>;
  parentRefName: string | null;
  input: NullableJson;
  inputRef: string | null;
  output: NullableJson;
  outputRef: string | null;
  reasonForIncompletion: string | null;
  workerId: string | null;
  /** Fencing token: a worker whose lease expired cannot report a result. */
  leaseToken: string | null;
  /** Set once the decider has reacted to this task reaching a terminal state. */
  deciderSeenAt: Date | null;
  /** Where a successful output is cached, for tasks with `cacheConfig`. */
  cacheKey: Generated<string | null>;
  cacheTtlSeconds: Generated<number | null>;
  scheduledAt: Generated<Date>;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface TaskQueuesTable {
  /**
   * Denormalised from `TaskExecutions`, so the system-task poll needs no join
   * on the hottest table in the system. Written once at enqueue.
   */
  taskType: Generated<string>;
  id: DbGenerated<string>;
  namespaceId: string;
  queueName: string;
  taskId: string;
  workflowId: string;
  priority: Generated<number>;
  visibleAt: Generated<Date>;
  leaseExpiresAt: Date | null;
  leaseToken: string | null;
  workerId: string | null;
  enqueuedAt: Generated<Date>;
}

/** One row per workflow awaiting evaluation. The primary key *is* the dedupe. */
export interface DecideQueuesTable {
  workflowId: string;
  namespaceId: string;
  enqueuedAt: Generated<Date>;
  reason: string | null;
}

export interface TimersTable {
  id: Generated<string>;
  fireAt: Date;
  kind: string;
  namespaceId: string;
  workflowId: string;
  taskId: string | null;
  payload: JsonDefaulted;
  claimedAt: Date | null;
}

export interface OutboxEventsTable {
  id: DbGenerated<string>;
  namespaceId: string;
  topic: string;
  payload: Json;
  createdAt: Generated<Date>;
  publishedAt: Date | null;
  /** Delivery attempts so far; drives backoff and the dead-letter threshold. */
  attempts: Generated<number>;
  nextAttemptAt: Generated<Date>;
  lastError: string | null;
  /** Set when delivery was abandoned. The row is kept, never deleted. */
  deadLetteredAt: Date | null;
}

export interface WorkflowEventsTable {
  id: DbGenerated<string>;
  workflowId: string;
  seq: number;
  type: string;
  payload: JsonDefaulted;
  at: Generated<Date>;
}

/** Unpartitioned by design, so its unique constraint actually constrains. */
export interface IdempotencyKeysTable {
  namespaceId: string;
  key: string;
  workflowId: string;
  createdAt: Generated<Date>;
}

export interface SemaphoresTable {
  namespaceId: string;
  name: string;
  permits: number;
}

export interface SemaphoreHoldersTable {
  namespaceId: string;
  name: string;
  taskId: string;
  workflowId: string;
  acquiredAt: Generated<Date>;
  /** Permits are leased, so a crashed holder cannot hold one forever. */
  leaseExpiresAt: Date;
}

/**
 * Token buckets for rate limits.
 *
 * Separate from the queue because queue rows are deleted on acknowledgement,
 * and the recent history a rate limit needs is exactly what that throws away.
 */
export interface RateLimitBucketsTable {
  namespaceId: string;
  queueName: string;
  windowStart: Date;
  count: Generated<number>;
}

/** Applied migrations, owned by the migrator. */
export interface MigrationsTable {
  name: string;
  appliedAt: Generated<Date>;
}

/**
 * A worker fleet or automation.
 *
 * Authenticates with `keyId` + secret and exchanges them for a short-lived
 * scoped token. The secret is stored as a scrypt hash: the exchange happens
 * rarely, so a deliberately slow verification costs nothing and buys
 * defence-in-depth if the table ever leaks.
 */
export interface ServiceAccountsTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  /** The public half of the credential; safe to log. */
  keyId: string;
  secretHash: string;
  secretSalt: string;
  scopes: string[];
  /** Set to disable without deleting, so audit history keeps its subject. */
  disabledAt: Date | null;
  createdAt: Generated<Date>;
  lastUsedAt: Date | null;
}

/**
 * A long-lived credential presented directly, without a token exchange.
 *
 * Hashed with SHA-256 rather than scrypt, and that difference is deliberate:
 * this is verified on *every* request, and a token is 256 bits of machine
 * generated entropy with no offline search to slow down. A slow KDF here would
 * add latency to the hot path and defend against nothing.
 */
export interface ApiKeysTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  /** Leading characters, kept in clear so a key is identifiable in a UI. */
  prefix: string;
  tokenHash: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Generated<Date>;
  lastUsedAt: Date | null;
}

/** A person. Authenticates with email and password; see `password.ts`. */
export interface UsersTable {
  id: Generated<string>;
  namespaceId: string;
  email: string;
  name: string;
  /** Self-describing `scrypt$N$r$p$salt$hash`, so cost can be raised later. */
  passwordHash: string;
  scopes: string[];
  disabledAt: Date | null;
  failedLogins: Generated<number>;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/**
 * A browser session.
 *
 * A row rather than a signed token, because logout has to actually revoke —
 * a stateless token stays valid until it expires, however urgently you need it
 * gone.
 */
export interface SessionsTable {
  id: Generated<string>;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  lastSeenAt: Generated<Date>;
  revokedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Generated<Date>;
}

/**
 * A callback slot for a waiting `WAIT_FOR_WEBHOOK` task.
 *
 * The token in the URL is the authorisation — a third party cannot hold an API
 * credential — so it is stored hashed, completes exactly one task, is
 * single-use, and expires.
 */
/**
 * A task awaiting a person.
 *
 * `assigneeId` is routing — who it is *for*. `claimedBy` is possession — who is
 * working on it *now*. Keeping them separate is what lets a task be assigned to
 * someone who has not started it, and released back to the pool without losing
 * who it was meant for.
 */
export interface HumanTasksTable {
  id: Generated<string>;
  namespaceId: string;
  workflowId: string;
  taskId: string;
  refName: string;
  title: string;
  description: string | null;
  /** JSON Schema for the expected result, so a UI can render a form. */
  form: NullableJson<Record<string, unknown>>;
  assigneeId: string | null;
  /** Routed to a team rather than a person; anyone in it may claim. */
  assigneeGroupId: string | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  completedBy: string | null;
  completedAt: Date | null;
  dueAt: Date | null;
  createdAt: Generated<Date>;
  /** The template the form was copied from, when it came from one. */
  formTemplate: string | null;
  formVersion: number | null;
  /** Resolved assignment chain; null when the task names at most one assignee. */
  assignments: NullableJson<ResolvedAssignment[]>;
  assignmentIndex: Generated<number>;
  assignedAt: Generated<Date>;
  completionStrategy: Generated<string>;
  skippedReason: string | null;
  /** Claim for the assignee as soon as the task is assigned to one person. */
  autoClaim: Generated<boolean>;
  /** Workflows started as the task changes state. */
  triggers: NullableJson<HumanTaskTrigger[]>;
}

/** The moments in a human task's life a trigger can start a workflow on. */
export const HUMAN_TASK_EVENTS = ['ASSIGNED', 'CLAIMED', 'RELEASED', 'COMPLETED', 'SKIPPED', 'TIMED_OUT'] as const;
export type HumanTaskEvent = (typeof HUMAN_TASK_EVENTS)[number];

/** Starts `workflow` when a human task reaches `on`. */
export interface HumanTaskTrigger {
  on: HumanTaskEvent;
  workflow: string;
  version?: number;
}

/** One link of a human task's assignment chain, with its target resolved to an id. */
export interface ResolvedAssignment {
  kind: 'user' | 'group';
  id: string;
  /** What a person reads: an email or a group name. */
  label: string;
  /** Minutes to claim before moving on. 0 means never moves on. */
  slaMinutes: number;
}

/**
 * A cron trigger.
 *
 * The row is the schedule: state lives here rather than in a process, which is
 * what makes several replicas safe.
 */
export interface SchedulesTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  description: string | null;
  cron: string;
  timezone: Generated<string>;
  defName: string;
  defVersion: number | null;
  input: JsonDefaulted;
  correlationId: string | null;
  priority: Generated<number>;
  paused: Generated<boolean>;
  startAt: Date | null;
  endAt: Date | null;
  overlapPolicy: Generated<string>;
  catchupPolicy: Generated<string>;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastWorkflowId: string | null;
  runCount: Generated<string>;
  lastError: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/**
 * An inbound event handler — the mirror of an outbox topic handler.
 *
 * A row rather than configuration, because enabling, disabling and inspecting
 * one are operational acts, not redeploys.
 */
export interface EventHandlersTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  description: string | null;
  source: string;
  topic: string;
  condition: string | null;
  action: string;
  defName: string | null;
  defVersion: number | null;
  inputTemplate: JsonDefaulted;
  correlationId: string | null;
  workflowIdExpr: string | null;
  taskRefExpr: string | null;
  enabled: Generated<boolean>;
  eventCount: Generated<string>;
  lastEventAt: Date | null;
  lastError: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/**
 * A secret or an environment variable.
 *
 * One table for both: they differ only in whether the value is sealed, and the
 * naming, listing, namespacing and audit columns are identical.
 */
export interface SecretsTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  description: string | null;
  sealed: Generated<boolean>;
  /** The sealed envelope, or a plain string for a variable. */
  value: JsonDefaulted<unknown>;
  keyId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

/**
 * A named set of people, carrying scopes.
 *
 * One concept instead of separate roles and groups: a group that carries scopes
 * is a role with members, and keeping them apart means maintaining a mapping
 * between the two for no gain in expressiveness.
 */
/**
 * A control-plane change.
 *
 * Not a record of what ran — `WorkflowEvents` does that per execution, and
 * duplicating it here would double the write volume of the busiest path in the
 * system. This is who changed a definition, a schedule, a secret or a
 * credential, which is the set that matters after an incident.
 */
/**
 * A binding from an externally-vouched identity to a service account.
 *
 * One table for mTLS and OIDC: they differ only in what the identity is called.
 * The binding is explicit, never inferred from a name match — the CA or IdP
 * decides who you are, the operator decides what that may do.
 */
export interface WorkloadIdentitiesTable {
  id: Generated<string>;
  namespaceId: string;
  serviceAccountId: string;
  kind: string;
  issuer: string;
  subject: string;
  description: string | null;
  disabledAt: Date | null;
  lastSeenAt: Date | null;
  createdBy: string | null;
  createdAt: Generated<Date>;
}

export interface AuditEventsTable {
  id: Generated<string>;
  namespaceId: string;
  actorType: string;
  actorId: string;
  actorName: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  detail: JsonDefaulted;
  ip: string | null;
  userAgent: string | null;
  outcome: Generated<string>;
  at: Generated<Date>;
}

export interface GroupsTable {
  id: Generated<string>;
  namespaceId: string;
  name: string;
  description: string | null;
  scopes: Generated<string[]>;
  /** Tag patterns this group's members may reach. `env:prod`, `team:*`. */
  tagGrants: Generated<string[]>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface GroupMembersTable {
  groupId: string;
  userId: string;
  addedAt: Generated<Date>;
  addedBy: string | null;
}

export interface WebhookCallbacksTable {
  id: Generated<string>;
  namespaceId: string;
  workflowId: string;
  taskId: string;
  refName: string;
  tokenHash: string;
  /** Shared secret for senders that HMAC-sign their deliveries. */
  signingKey: string | null;
  expiresAt: Date | null;
  consumedAt: Date | null;
  createdAt: Generated<Date>;
}

export interface Database {
  Namespaces: NamespacesTable;
  WorkflowDefinitions: WorkflowDefinitionsTable;
  TaskDefinitions: TaskDefinitionsTable;
  TaskLogs: TaskLogsTable;
  WorkerPolls: WorkerPollsTable;
  EventExecutions: EventExecutionsTable;
  IncomingWebhooks: IncomingWebhooksTable;
  StatusListeners: StatusListenersTable;
  ScheduleRuns: ScheduleRunsTable;
  SavedViews: SavedViewsTable;
  ResourceGrants: ResourceGrantsTable;
  Integrations: IntegrationsTable;
  Prompts: PromptsTable;
  VectorDocuments: VectorDocumentsTable;
  WorkflowMessages: WorkflowMessagesTable;
  TaskOutputCache: TaskOutputCacheTable;
  EnvironmentVariables: EnvironmentVariablesTable;
  Schemas: SchemasTable;
  FormTemplates: FormTemplatesTable;
  WorkflowExecutions: WorkflowExecutionsTable;
  TaskExecutions: TaskExecutionsTable;
  TaskQueues: TaskQueuesTable;
  DecideQueues: DecideQueuesTable;
  Timers: TimersTable;
  OutboxEvents: OutboxEventsTable;
  WorkflowEvents: WorkflowEventsTable;
  IdempotencyKeys: IdempotencyKeysTable;
  Semaphores: SemaphoresTable;
  SemaphoreHolders: SemaphoreHoldersTable;
  RateLimitBuckets: RateLimitBucketsTable;
  WebhookCallbacks: WebhookCallbacksTable;
  HumanTasks: HumanTasksTable;
  Schedules: SchedulesTable;
  EventHandlers: EventHandlersTable;
  Secrets: SecretsTable;
  AuditEvents: AuditEventsTable;
  WorkloadIdentities: WorkloadIdentitiesTable;
  Groups: GroupsTable;
  GroupMembers: GroupMembersTable;
  Users: UsersTable;
  Sessions: SessionsTable;
  ServiceAccounts: ServiceAccountsTable;
  ApiKeys: ApiKeysTable;
  Migrations: MigrationsTable;
}

// Convenience aliases for the shapes each table produces and accepts.
export type NamespaceRow = Selectable<NamespacesTable>;
export type UserRow = Selectable<UsersTable>;
export type SessionRow = Selectable<SessionsTable>;
export type ServiceAccountRow = Selectable<ServiceAccountsTable>;
export type ApiKeyRow = Selectable<ApiKeysTable>;
export type WorkflowDefinitionRow = Selectable<WorkflowDefinitionsTable>;
export type NewWorkflowDefinition = Insertable<WorkflowDefinitionsTable>;
export type TaskDefinitionRow = Selectable<TaskDefinitionsTable>;
export type NewTaskDefinition = Insertable<TaskDefinitionsTable>;
export type WorkflowExecutionRow = Selectable<WorkflowExecutionsTable>;
export type NewWorkflowExecution = Insertable<WorkflowExecutionsTable>;
export type WorkflowExecutionUpdate = Updateable<WorkflowExecutionsTable>;
export type TaskExecutionRow = Selectable<TaskExecutionsTable>;
export type NewTaskExecution = Insertable<TaskExecutionsTable>;
export type TaskQueueRow = Selectable<TaskQueuesTable>;

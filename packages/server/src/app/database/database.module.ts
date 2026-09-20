import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import {
  ConcurrencyRepository,
  DecideQueueRepository,
  Evaluator,
  ExecutionControlService,
  FilesystemBlobStore,
  S3BlobStore,
  type BlobStore,
  LongPollService,
  MetadataRepository,
  NamespaceRepository,
  OutboxRelay,
  KafkaJsProducer,
  StatusListenerRepository,
  SavedViewRepository,
  ResourceGrantRepository,
  STATUS_LISTENER_TOPIC,
  statusListenerHandler,
  statusSinkSender,
  type KafkaProducer,
  type StatusSinkSender,
  kafkaOutboxHandler,
  natsOutboxHandler,
  amqpOutboxHandler,
  redisOutboxHandler,
  sqsOutboxHandler,
  type BrokerSink,
  registerWorkflowStartHandlers,
  OutboxRepository,
  PartitionManager,
  PayloadGarbageCollector,
  PayloadStore,
  QueueNotifier,
  WorkflowEventNotifier,
  SchemaValidator,
  SearchRepository,
  StuckWorkflowSweeper,
  SystemTaskRunner,
  TaskDispatchService,
  TaskQueueRepository,
  TaskLogRepository,
  WorkerPollRepository,
  EventExecutionRepository,
  WorkflowMessageRepository,
  EnvironmentRepository,
  SchemaRegistryRepository,
  FormTemplateRepository,
  TimeoutSweeper,
  TimerRepository,
  WebhookRepository,
  HumanTaskRepository,
  EventDispatcher,
  IncomingWebhookRepository,
  EventHandlerRepository,
  AuditRepository,
  QuotaService,
  WorkloadIdentityRepository,
  GroupRepository,
  OutputSealer,
  SecretCipher,
  SecretRepository,
  IntegrationRepository,
  PromptRepository,
  VectorRepository,
  aiResolver,
  workflowTools,
  httpServiceResolver,
  SecretResolver,
  parseMasterKeys,
  ScheduleRepository,
  SchedulerRunner,
  WorkflowEventsRepository,
  WorkflowRepository,
  assertDatabaseCapabilities,
  createDatabase,
  migrate,
  seedFirstInstall,
  type Db,
} from '@node-flow-dev/store';
import { CircuitBreaker, TaskExecutorRegistry, WebhookTaskExecutor, defaultExecutors, type AiExecutorOptions } from '@node-flow-dev/tasks';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';

/**
 * The database connection and everything built directly on it.
 *
 * All of `store`'s repositories are plain classes taking a `Db` — no
 * decorators, no framework coupling, which is what lets them be tested against
 * a real Postgres with no Nest container. This module is the single seam where
 * they become injectable, so that property survives contact with the framework.
 *
 * Global because the alternative is re-exporting fifteen providers from every
 * feature module that needs one.
 */

export const DB = Symbol('DB');

/** Sends one status event to one listener's sink; shared by the relay and the "send test event" route. */
export const STATUS_SINK_SENDER = Symbol('STATUS_SINK_SENDER');

/** Kafka producers by configured cluster name, one per process. */
export const KAFKA_PRODUCERS = Symbol('KAFKA_PRODUCERS');
/** Outbox handlers for NATS, AMQP and SQS connections, keyed by the sink prefix they claim. */
export const BROKER_SINKS = Symbol('BROKER_SINKS');
/** What the AI tasks resolve through: integrations, prompts, vectors and workflow tools. */
export const AI_EXECUTOR_OPTIONS = Symbol('AI_EXECUTOR_OPTIONS');
type BrokerSinks = Map<string, BrokerSink>;

/**
 * The payload store this install is configured for.
 *
 * Two places need one — the offloader and the collector — and they must agree:
 * a collector pointed at a different store would list nothing, decide every
 * blob is an orphan, or delete from the wrong place. One function, so the
 * choice cannot be made twice and differ.
 */
function blobStoreFor(config: AppConfig): BlobStore {
  if (config.NODE_FLOW_BLOB_STORE === 's3') {
    return new S3BlobStore({ ...config.NODE_FLOW_BLOB_S3, bucket: config.NODE_FLOW_BLOB_S3.bucket as string });
  }
  return new FilesystemBlobStore(config.NODE_FLOW_BLOB_ROOT);
}

/** Providers built straight from the pool, in dependency order. */
const repositories = [
  { provide: StatusListenerRepository, deps: [DB] },
  { provide: WorkflowRepository, deps: [DB, PayloadStore, MetadataRepository, StatusListenerRepository] },
  { provide: DecideQueueRepository, deps: [DB] },
  { provide: TaskQueueRepository, deps: [DB] },
  { provide: TaskLogRepository, deps: [DB] },
  { provide: WorkerPollRepository, deps: [DB] },
  { provide: EventExecutionRepository, deps: [DB] },
  { provide: WorkflowMessageRepository, deps: [DB, WorkflowRepository, DecideQueueRepository] },
  { provide: EnvironmentRepository, deps: [DB] },
  { provide: SchemaRegistryRepository, deps: [DB] },
  { provide: FormTemplateRepository, deps: [DB] },
  { provide: OutboxRepository, deps: [DB] },
  { provide: TimerRepository, deps: [DB] },
  { provide: ConcurrencyRepository, deps: [DB] },
  { provide: WorkflowEventsRepository, deps: [DB] },
  { provide: SearchRepository, deps: [DB] },
  { provide: SavedViewRepository, deps: [DB] },
  { provide: ResourceGrantRepository, deps: [DB] },
  { provide: IntegrationRepository, deps: [DB] },
  { provide: PromptRepository, deps: [DB] },
  { provide: VectorRepository, deps: [DB] },
  { provide: PartitionManager, deps: [DB] },
  { provide: WebhookRepository, deps: [DB, WorkflowRepository, DecideQueueRepository] },
  {
    provide: HumanTaskRepository,
    deps: [DB, WorkflowRepository, DecideQueueRepository, FormTemplateRepository, SchemaValidator, OutboxRepository],
  },
  { provide: ScheduleRepository, deps: [DB] },
  { provide: EventHandlerRepository, deps: [DB] },
  { provide: GroupRepository, deps: [DB] },
  { provide: AuditRepository, deps: [DB] },
  { provide: QuotaService, deps: [DB] },
  { provide: WorkloadIdentityRepository, deps: [DB] },
  { provide: NamespaceRepository, deps: [DB] },
] as const;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Db => {
        const logger = new Logger('DatabasePool');
        return createDatabase({
          url: config.DATABASE_URL,
          maxConnections: config.DATABASE_MAX_CONNECTIONS,
          // A warning, not an error: the pool has already replaced the
          // connection. Repeated warnings are the signal worth alerting on.
          onConnectionError: (error) =>
            logger.warn(`pooled connection lost while idle: ${error.message}`),
        });
      },
    },

    {
      provide: PayloadStore,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new PayloadStore(blobStoreFor(config), config.NODE_FLOW_PAYLOAD_THRESHOLD_BYTES),
    },

    ...repositories.map(({ provide, deps }) => ({
      provide,
      inject: [...deps],
      useFactory: (...args: unknown[]) =>
        new (provide as new (...a: unknown[]) => unknown)(...args),
    })),

    {
      provide: PayloadGarbageCollector,
      inject: [DB, APP_CONFIG],
      useFactory: (db: Db, config: AppConfig) =>
        new PayloadGarbageCollector(db, blobStoreFor(config)),
    },

    { provide: SchemaValidator, useFactory: () => new SchemaValidator() },

    {
      provide: MetadataRepository,
      inject: [DB, SchemaValidator, SchemaRegistryRepository],
      useFactory: (db: Db, schemas: SchemaValidator, registry: SchemaRegistryRepository) =>
        new MetadataRepository(db, undefined, schemas, registry),
    },

    {
      provide: TaskDispatchService,
      inject: [
        DB,
        WorkflowRepository,
        TaskQueueRepository,
        DecideQueueRepository,
        TimerRepository,
        ConcurrencyRepository,
        SchemaValidator,
        MetadataRepository,
        PayloadStore,
        SecretResolver,
        OutputSealer,
      ],
      useFactory: (
        db: Db,
        workflows: WorkflowRepository,
        queue: TaskQueueRepository,
        decide: DecideQueueRepository,
        timers: TimerRepository,
        concurrency: ConcurrencyRepository,
        schemas: SchemaValidator,
        metadata: MetadataRepository,
        payloads: PayloadStore,
        secrets: SecretResolver,
        sealer: OutputSealer
      ) =>
        new TaskDispatchService(
          db,
          workflows,
          queue,
          decide,
          timers,
          concurrency,
          schemas,
          metadata.taskDefLoader,
          payloads,
          secrets,
          sealer
        ),
    },

    {
      provide: ExecutionControlService,
      inject: [
        DB,
        WorkflowRepository,
        DecideQueueRepository,
        TaskQueueRepository,
        TimerRepository,
        ConcurrencyRepository,
        WorkflowEventsRepository,
        WebhookRepository,
        HumanTaskRepository,
      ],
      useFactory: (
        db: Db,
        workflows: WorkflowRepository,
        decide: DecideQueueRepository,
        queue: TaskQueueRepository,
        timers: TimerRepository,
        concurrency: ConcurrencyRepository,
        events: WorkflowEventsRepository,
        webhooks: WebhookRepository,
        humanTasks: HumanTaskRepository
      ) =>
        new ExecutionControlService(
          db,
          workflows,
          decide,
          queue,
          timers,
          concurrency,
          events,
          webhooks,
          humanTasks
        ),
    },

    {
      // A dedicated listener connection, opened and closed with the app. Not
      // pooled: a pooled connection is handed back after each query and would
      // take its LISTEN registration with it.
      provide: QueueNotifier,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger(QueueNotifier.name);
        return new QueueNotifier({
          url: config.DATABASE_URL,
          onError: (error) => logger.warn(`listener connection problem: ${String(error)}`),
        });
      },
    },

    {
      // A second dedicated listener, for the same reason as the first: one
      // channel each, and a `LISTEN` cannot share a pooled connection.
      provide: WorkflowEventNotifier,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const logger = new Logger(WorkflowEventNotifier.name);
        return new WorkflowEventNotifier({
          url: config.DATABASE_URL,
          onError: (error) => logger.warn(`listener connection problem: ${String(error)}`),
        });
      },
    },

    {
      provide: LongPollService,
      inject: [TaskDispatchService, QueueNotifier],
      useFactory: (dispatch: TaskDispatchService, notifier: QueueNotifier) =>
        new LongPollService(dispatch, notifier),
    },

    {
      provide: TimeoutSweeper,
      inject: [DB, TimerRepository, WorkflowRepository, DecideQueueRepository, MetadataRepository, OutboxRepository],
      useFactory: (
        db: Db,
        timers: TimerRepository,
        workflows: WorkflowRepository,
        decide: DecideQueueRepository,
        metadata: MetadataRepository,
        outbox: OutboxRepository
      ) => new TimeoutSweeper(db, timers, workflows, decide, { blueprints: metadata, outbox }),
    },

    {
      provide: AI_EXECUTOR_OPTIONS,
      inject: [IntegrationRepository, PromptRepository, VectorRepository, SecretRepository, WorkflowRepository, MetadataRepository, DecideQueueRepository, SchemaRegistryRepository],
      useFactory: (
        integrations: IntegrationRepository,
        prompts: PromptRepository,
        vectors: VectorRepository,
        secrets: SecretRepository,
        workflows: WorkflowRepository,
        metadata: MetadataRepository,
        decide: DecideQueueRepository,
        schemas: SchemaRegistryRepository
      ): AiExecutorOptions => ({
        resolver: aiResolver(integrations, prompts, secrets),
        vectors,
        workflows: workflowTools(workflows, metadata, decide, schemas),
      }),
    },

    {
      provide: TaskExecutorRegistry,
      inject: [APP_CONFIG, SecretRepository, AI_EXECUTOR_OPTIONS, IntegrationRepository],
      useFactory: (config: AppConfig, secrets: SecretRepository, ai: AiExecutorOptions, integrations: IntegrationRepository) =>
        defaultExecutors({
          ai,
          // One breaker for every outbound task in this process, so `HTTP`,
          // `HTTP_POLL` and `gRPC` calling the same dying dependency reach the
          // same conclusion instead of each keeping its own tally.
          breaker: new CircuitBreaker(config.NODE_FLOW_CIRCUIT_BREAKER),
          http: {
            allowPrivateAddresses: config.NODE_FLOW_HTTP_ALLOW_PRIVATE,
            allowedHosts: config.NODE_FLOW_HTTP_ALLOWED_HOSTS,
            // Registered HTTP services, so a definition names one instead of
            // carrying a URL and a key of its own.
            services: httpServiceResolver(integrations, secrets),
          },
          inline: {
            timeoutMs: config.NODE_FLOW_INLINE_TIMEOUT_MS,
            memoryLimitBytes: config.NODE_FLOW_INLINE_MEMORY_BYTES,
          },
          jq: {
            timeoutMs: config.NODE_FLOW_JQ_TIMEOUT_MS,
            maxOutputBytes: config.NODE_FLOW_JQ_MAX_OUTPUT_BYTES,
          },
          sql: {
            datasources: config.NODE_FLOW_SQL_DATASOURCES,
            statementTimeoutMs: config.NODE_FLOW_SQL_STATEMENT_TIMEOUT_MS,
            maxRows: config.NODE_FLOW_SQL_MAX_ROWS,
          },
          grpc: { services: config.NODE_FLOW_GRPC_SERVICES },
          email: { transports: config.NODE_FLOW_SMTP_TRANSPORTS },
          // Absent when no master key is configured, which makes UPDATE_SECRET
          // fail loudly rather than appear to store something.
          secrets: secrets.canSeal ? secrets : undefined,
        }),
    },

    {
      provide: SystemTaskRunner,
      inject: [
        TaskExecutorRegistry,
        TaskDispatchService,
        WorkflowRepository,
        PayloadStore,
        APP_CONFIG,
        SecretResolver,
      ],
      useFactory: (
        registry: TaskExecutorRegistry,
        dispatch: TaskDispatchService,
        workflows: WorkflowRepository,
        payloads: PayloadStore,
        config: AppConfig,
        secrets: SecretResolver
      ) => {
        const logger = new Logger(SystemTaskRunner.name);
        return new SystemTaskRunner(
          registry,
          dispatch,
          workflows,
          payloads,
          {
            concurrency: config.NODE_FLOW_SYSTEM_TASK_CONCURRENCY,
            onError: (error, context) =>
              logger.warn(
                `system task ${context.taskId ?? '?'} (${context.type ?? '?'}): ${String(error)}`
              ),
          },
          secrets
        );
      },
    },

    {
      provide: StuckWorkflowSweeper,
      inject: [DB, DecideQueueRepository],
      useFactory: (db: Db, decide: DecideQueueRepository) =>
        new StuckWorkflowSweeper(db, decide),
    },

    {
      provide: SecretRepository,
      inject: [DB, APP_CONFIG],
      useFactory: (db: Db, config: AppConfig) => {
        const keys = parseMasterKeys(config.NODE_FLOW_SECRET_KEYS);
        // No key means no cipher, and the repository refuses to seal rather
        // than quietly storing credentials in clear.
        return new SecretRepository(db, keys.length > 0 ? new SecretCipher(keys) : undefined);
      },
    },

    {
      provide: OutputSealer,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const keys = parseMasterKeys(config.NODE_FLOW_SECRET_KEYS);
        return new OutputSealer(keys.length > 0 ? new SecretCipher(keys) : undefined);
      },
    },

    {
      provide: SecretResolver,
      inject: [SecretRepository, OutputSealer, WorkflowRepository],
      useFactory: (
        secrets: SecretRepository,
        sealer: OutputSealer,
        workflows: WorkflowRepository
      ) => new SecretResolver(secrets, sealer, workflows),
    },

    {
      provide: IncomingWebhookRepository,
      inject: [DB, SecretRepository, EventDispatcher],
      useFactory: (db: Db, secrets: SecretRepository, dispatcher: EventDispatcher) =>
        new IncomingWebhookRepository(db, secrets, dispatcher),
    },

    {
      provide: EventDispatcher,
      inject: [
        DB,
        EventHandlerRepository,
        WorkflowRepository,
        MetadataRepository,
        DecideQueueRepository,
        APP_CONFIG,
        EventExecutionRepository,
      ],
      useFactory: (
        db: Db,
        handlers: EventHandlerRepository,
        workflows: WorkflowRepository,
        metadata: MetadataRepository,
        decide: DecideQueueRepository,
        config: AppConfig,
        monitor: EventExecutionRepository
      ) =>
        new EventDispatcher(db, handlers, workflows, metadata, decide, {
          monitor,
          // A handler condition is user code from an API, so it gets the same
          // limits as an INLINE task rather than limits of its own.
          sandbox: {
            timeoutMs: config.NODE_FLOW_INLINE_TIMEOUT_MS,
            memoryLimitBytes: config.NODE_FLOW_INLINE_MEMORY_BYTES,
          },
        }),
    },

    {
      provide: SchedulerRunner,
      inject: [DB, ScheduleRepository, WorkflowRepository, MetadataRepository, DecideQueueRepository],
      useFactory: (
        db: Db,
        schedules: ScheduleRepository,
        workflows: WorkflowRepository,
        metadata: MetadataRepository,
        decide: DecideQueueRepository
      ) => new SchedulerRunner(db, schedules, workflows, metadata, decide),
    },

    {
      provide: KAFKA_PRODUCERS,
      inject: [APP_CONFIG],
      // Each lazily connected — a cluster that is configured but never used must
      // not turn an unreachable broker into a server that will not start.
      useFactory: (config: AppConfig) =>
        new Map<string, KafkaProducer>(
          Object.entries(config.NODE_FLOW_KAFKA_CLUSTERS).map(([name, cluster]) => [name, new KafkaJsProducer(cluster)])
        ),
    },

    {
      provide: BROKER_SINKS,
      inject: [APP_CONFIG],
      // Connected on first publish, like the Kafka producers.
      useFactory: (config: AppConfig): BrokerSinks =>
        new Map([
          ...Object.entries(config.NODE_FLOW_NATS_CONNECTIONS).map(([name, c]) => [`nats:${name}:`, natsOutboxHandler(`nats:${name}`, c)] as const),
          ...Object.entries(config.NODE_FLOW_AMQP_CONNECTIONS).map(([name, c]) => [`amqp:${name}:`, amqpOutboxHandler(`amqp:${name}`, c)] as const),
          ...Object.entries(config.NODE_FLOW_SQS_CONNECTIONS).map(([name, c]) => [`sqs:${name}:`, sqsOutboxHandler(`sqs:${name}`, c)] as const),
          ...Object.entries(config.NODE_FLOW_REDIS_CONNECTIONS).map(([name, c]) => [`redis:${name}:`, redisOutboxHandler(`redis:${name}`, c)] as const),
        ]),
    },

    {
      provide: STATUS_SINK_SENDER,
      inject: [APP_CONFIG, SecretRepository, KAFKA_PRODUCERS, BROKER_SINKS],
      useFactory: (config: AppConfig, secrets: SecretRepository, kafka: Map<string, KafkaProducer>, brokers: BrokerSinks): StatusSinkSender => {
        // The WEBHOOK task's executor, so a listener URL gets the same SSRF guard,
        // redirect checks, size caps and signing as a webhook sent from a workflow.
        const executor = new WebhookTaskExecutor({
          allowPrivateAddresses: config.NODE_FLOW_HTTP_ALLOW_PRIVATE,
          allowedHosts: config.NODE_FLOW_HTTP_ALLOWED_HOSTS,
          defaultTimeoutMs: 15_000,
        });
        return statusSinkSender({
          secrets,
          kafka,
          brokers,
          webhook: async ({ url, event, secret, headers, deliveryId }) => {
            const outcome = await executor.execute({
              taskId: deliveryId,
              workflowId: String(event['workflowId'] ?? ''),
              namespaceId: '',
              input: { url, event, ...(secret ? { secret } : {}), ...(headers ? { headers } : {}) },
              signal: AbortSignal.timeout(20_000),
              heartbeat: async () => undefined,
              state: {},
            });
            if (outcome.status !== 'COMPLETED') {
              throw new Error(outcome.status === 'FAILED' ? outcome.reason : `webhook delivery ended ${outcome.status}`);
            }
          },
        });
      },
    },

    {
      provide: OutboxRelay,
      inject: [DB, OutboxRepository, WorkflowRepository, MetadataRepository, DecideQueueRepository, KAFKA_PRODUCERS, StatusListenerRepository, STATUS_SINK_SENDER, BROKER_SINKS],
      useFactory: (
        db: Db,
        outbox: OutboxRepository,
        workflows: WorkflowRepository,
        metadata: MetadataRepository,
        decide: DecideQueueRepository,
        kafka: Map<string, KafkaProducer>,
        listeners: StatusListenerRepository,
        sendStatus: StatusSinkSender,
        brokers: BrokerSinks
      ) => {
        const relay = new OutboxRelay(db, outbox);

        // Without these, `SUB_WORKFLOW` and `START_WORKFLOW` publish to the
        // outbox and nothing ever consumes it: the events back off, dead-letter,
        // and the parent waits forever for a child that was never created. They
        // were missing until a Kafka sink needed registering in the same place.
        registerWorkflowStartHandlers(relay, workflows, metadata, decide);

        for (const [name, producer] of kafka) relay.on(`kafka:${name}`, kafkaOutboxHandler(producer));
        // `nats:default:orders.created` — the subject, queue or exchange follows the connection.
        for (const [prefix, handler] of brokers) relay.onPrefix(prefix, handler);

        // Change data capture: each row is one change for one listener.
        relay.on(
          STATUS_LISTENER_TOPIC,
          statusListenerHandler(listeners, sendStatus, async (namespaceId, name, version) =>
            (await metadata.load(namespaceId, name, version).catch(() => undefined))?.maskedFields
          )
        );

        return relay;
      },
    },

    {
      provide: Evaluator,
      inject: [
        DB,
        WorkflowRepository,
        DecideQueueRepository,
        TaskQueueRepository,
        OutboxRepository,
        MetadataRepository,
        TimerRepository,
        WorkflowEventsRepository,
        PayloadStore,
        SchemaValidator,
        WebhookRepository,
        HumanTaskRepository,
        EnvironmentRepository,
        WorkflowMessageRepository,
      ],
      useFactory: (
        db: Db,
        workflows: WorkflowRepository,
        decide: DecideQueueRepository,
        queue: TaskQueueRepository,
        outbox: OutboxRepository,
        metadata: MetadataRepository,
        timers: TimerRepository,
        events: WorkflowEventsRepository,
        payloads: PayloadStore,
        schemas: SchemaValidator,
        webhooks: WebhookRepository,
        humanTasks: HumanTaskRepository,
        environment: EnvironmentRepository,
        messages: WorkflowMessageRepository
      ) =>
        new Evaluator(
          db,
          workflows,
          decide,
          queue,
          outbox,
          metadata,
          metadata.taskDefLoader,
          timers,
          events,
          payloads,
          schemas,
          webhooks,
          humanTasks,
          environment,
          messages
        ),
    },
  ],
  exports: [
    DB,
    PayloadStore,
    PayloadGarbageCollector,
    MetadataRepository,
    TaskDispatchService,
    ExecutionControlService,
    SchemaValidator,
    TaskExecutorRegistry,
    SystemTaskRunner,
    QueueNotifier,
    WorkflowEventNotifier,
    LongPollService,
    TimeoutSweeper,
    StuckWorkflowSweeper,
    OutboxRelay,
    STATUS_SINK_SENDER,
    KAFKA_PRODUCERS,
    BROKER_SINKS,
    AI_EXECUTOR_OPTIONS,
    SchedulerRunner,
    EventDispatcher,
    IncomingWebhookRepository,
    SecretRepository,
    SecretResolver,
    Evaluator,
    ...repositories.map((r) => r.provide),
  ],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly notifier: QueueNotifier,
    private readonly eventNotifier: WorkflowEventNotifier,
    @Inject(BROKER_SINKS) private readonly brokerSinks: BrokerSinks
  ) {}

  /**
   * Verifies and migrates before the app accepts traffic.
   *
   * `onModuleInit` rather than a lifecycle hook further out: if the schema is
   * wrong the process must not reach the point of serving requests, and Nest
   * aborts the boot when this throws.
   */
  async onModuleInit(): Promise<void> {
    // Postgres 18 is a hard requirement, not a recommendation — `uuidv7()` and
    // the partitioning the data model assumes are both 18+. Checked here so it
    // surfaces at boot rather than on the first insert.
    await assertDatabaseCapabilities(this.db);

    // `DATABASE_MIGRATE_ON_BOOT=false` turns off *migrations*, and nothing
    // else. It used to `return` here, which also skipped the seed and both
    // listeners below — so the multi-replica pattern the flag exists for
    // (migrate once from a job, disable on the pods) silently cost every pod
    // its long-poll wake-ups and its live execution stream. Both degrade to a
    // backstop poll rather than failing, which is why it read as "a bit slow"
    // instead of as a misconfiguration.
    if (this.config.DATABASE_MIGRATE_ON_BOOT) {
      const applied = await migrate(this.db);
      this.logger.log(
        applied.length > 0 ? `Applied migrations: ${applied.join(', ')}` : 'Schema up to date'
      );
    } else {
      this.logger.log('Skipping migrations (DATABASE_MIGRATE_ON_BOOT=false)');
    }

    await this.seedFirstInstall();

    // Long-poll is a latency optimisation, so a listener that fails to connect
    // must not fail the boot — workers fall back to their poll timeout and the
    // notifier keeps re-dialling in the background.
    await this.notifier.start();

    // Same reasoning: a live dashboard is a convenience over a durable log, so
    // a listener that cannot connect degrades the stream to its backstop poll
    // rather than preventing the server from starting.
    await this.eventNotifier.start();
  }

  /**
   * Gives a fresh database a namespace and an administrator to log in as.
   *
   * Runs after migrations for the obvious reason — the tables must exist — and
   * before the app serves traffic, so the dashboard is usable the moment the
   * port opens.
   *
   * A generated password is logged, once, as a block rather than a line. That
   * is deliberate: this is the only time it exists anywhere, and an operator
   * scanning a boot log should not be able to miss it. It is never logged when
   * the operator supplied the password, because then it is already theirs and
   * repeating it into a log file only spreads it.
   */
  private async seedFirstInstall(): Promise<void> {
    if (!this.config.NODE_FLOW_SEED) return;

    const result = await seedFirstInstall(this.db, {
      namespace: this.config.NODE_FLOW_SEED_NAMESPACE,
      email: this.config.NODE_FLOW_SEED_EMAIL,
      password: this.config.NODE_FLOW_SEED_PASSWORD,
    });

    if (!result.seeded) return;

    if (!result.generatedPassword) {
      this.logger.log(
        `Seeded namespace "${this.config.NODE_FLOW_SEED_NAMESPACE}" and administrator ${result.email}`
      );
      return;
    }

    this.logger.warn(
      [
        '',
        '  ┌─────────────────────────────────────────────────────────────┐',
        '  │  node-flow created your first administrator.                │',
        '  │  This password is shown once and is not recoverable.        │',
        '  └─────────────────────────────────────────────────────────────┘',
        '',
        `    namespace   ${this.config.NODE_FLOW_SEED_NAMESPACE}`,
        `    email       ${result.email}`,
        `    password    ${result.generatedPassword}`,
        '',
        '    Sign in, then change it. Set NODE_FLOW_SEED_PASSWORD to choose',
        '    your own, or NODE_FLOW_SEED=false to manage accounts elsewhere.',
        '',
      ].join('\n')
    );
  }

  /**
   * Closes the pool last.
   *
   * The runners hold transactions and task leases; destroying the pool while
   * one is mid-flight aborts it and leaves the lease to expire on a timeout
   * instead of being released. Nest calls shutdown hooks in reverse
   * registration order, and this module is registered first, so its hook runs
   * after the runners have stopped.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.eventNotifier.stop();
    await this.notifier.stop();
    await Promise.allSettled([...this.brokerSinks.values()].map((sink) => sink.close()));
    await this.db.destroy();
  }
}

import {
  ALL_ROLES,
  type AmqpConnectionConfig,
  type EngineRole,
  type NatsConnectionConfig,
  type RedisConnectionConfig,
  type SqsConnectionConfig,
} from '@node-flow-dev/store';
import type { SmtpTransportConfig } from '@node-flow-dev/tasks';
import { z } from 'zod';

/**
 * Every environment variable the server reads, validated once at boot.
 *
 * Validating here rather than at each use is what turns a whole class of
 * production incident into a startup failure. A mistyped `NODE_FLOW_ROLES`, a
 * missing database URL or a non-numeric port otherwise surfaces minutes later
 * as a confusing runtime error — or worse, as a silent default: a cluster where
 * every workflow starts and none progresses because no process took the
 * decider role.
 *
 * The rule this file follows: **a setting whose wrong value is silently
 * survivable gets no default.**
 */

const seconds = (fallback: number) => z.coerce.number().int().positive().default(fallback);

/**
 * A JSON object of connection name to broker settings, each required to name
 * `required` — so a typo fails the boot rather than a source that never connects.
 */
const brokerConnections = <T>(required: string) =>
  z
    .string()
    .default('{}')
    .transform((raw, ctx): Record<string, T> => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object of connection name to configuration');
        }
        for (const [name, config] of Object.entries(parsed as Record<string, Record<string, unknown> | null>)) {
          if (!/^[\w-]+$/.test(name)) throw new Error(`connection name "${name}" may use only letters, digits, _ and -`);
          const value = config?.[required];
          if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
            throw new Error(`connection "${name}" is missing "${required}"`);
          }
        }
        return parsed as Record<string, T>;
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    });

/** Booleans arrive as strings; accept the spellings people actually write. */
const boolean = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .default(fallback ? 'true' : 'false')
    .transform((value) => value === 'true' || value === '1' || value === 'yes');

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),

  /**
   * No default. A server that silently starts against `localhost/postgres`
   * because the real URL was missing is worse than one that refuses to boot.
   */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().positive().default(20),

  /**
   * Run pending migrations at boot.
   *
   * Convenient for development and single-node deployments; deliberately
   * disableable, because a multi-replica rollout wants migrations run once by a
   * job rather than raced by every pod. The migrator itself is safe under a
   * race — each migration is one transaction — but the surprise of schema
   * changes landing on deploy should be opt-out.
   */
  DATABASE_MIGRATE_ON_BOOT: boolean(true),

  /**
   * Create the first namespace and administrator on a database that has none.
   *
   * On by default so that starting the server is all it takes to have a working
   * install. It acts only when there are no namespaces at all, so leaving it on
   * costs one `SELECT` per boot on an install that is already set up.
   *
   * Turn it off where accounts are provisioned by something else — an identity
   * provider, a migration, configuration management — and an unexpected local
   * administrator would be a finding rather than a convenience.
   */
  NODE_FLOW_SEED: boolean(true),

  NODE_FLOW_SEED_NAMESPACE: z.string().min(1).default('default'),
  NODE_FLOW_SEED_EMAIL: z.string().email().default('admin@node-flow.dev'),

  /**
   * Password for the seeded administrator.
   *
   * Deliberately has no default. Unset, the seed generates 160 bits and prints
   * them once at boot, so no two installs share a credential; a default here
   * would put the same password on every deployment that never changed it,
   * which is the failure this whole arrangement exists to avoid. The
   * development compose file sets it explicitly, which is the right place for a
   * known-weak secret and the only place one belongs.
   */
  NODE_FLOW_SEED_PASSWORD: z.string().min(12).optional(),

  NODE_FLOW_ROLES: z
    .string()
    .default(ALL_ROLES.join(','))
    .transform((value, ctx): EngineRole[] => {
      const roles = value
        .split(',')
        .map((role) => role.trim().toLowerCase())
        .filter(Boolean);

      const unknown = roles.filter((role) => !ALL_ROLES.includes(role as EngineRole));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `unknown role(s): ${unknown.join(', ')} (expected ${ALL_ROLES.join(', ')})`,
        });
        return z.NEVER;
      }

      return [...new Set(roles as EngineRole[])];
    }),

  /**
   * Signing key for service-account access tokens.
   *
   * Required whenever the API is served. There is no development default on
   * purpose: a hardcoded fallback secret is the single most reliably exploited
   * misconfiguration in this class of system, precisely because it works.
   */
  NODE_FLOW_JWT_SECRET: z.string().min(32, 'NODE_FLOW_JWT_SECRET must be at least 32 characters'),
  NODE_FLOW_JWT_ISSUER: z.string().default('node-flow'),
  NODE_FLOW_ACCESS_TOKEN_TTL_SECONDS: seconds(3600),

  /** Where offloaded payloads live. Relative paths resolve against the CWD. */
  NODE_FLOW_BLOB_ROOT: z.string().default('.node-flow/blobs'),

  /**
   * Which store holds offloaded payloads.
   *
   * `fs` is the default and needs nothing, but it assumes every replica sees
   * the same disk. More than one node without a shared mount needs `s3`, or a
   * task eventually cannot read a payload another server wrote.
   */
  NODE_FLOW_BLOB_STORE: z.enum(['fs', 's3']).default('fs'),

  /**
   * The S3 (or S3-compatible) bucket for payloads, as JSON.
   *
   * `{"bucket":"nf-payloads","region":"eu-west-1"}` for AWS;
   * `{"bucket":"payloads","endpoint":"http://minio:9000","forcePathStyle":true,
   * "accessKeyId":"…","secretAccessKey":"…"}` for MinIO and friends. Leaving
   * the credentials out is the better deployment: the SDK then reads the
   * instance role or IRSA, and node-flow holds no long-lived keys.
   */
  NODE_FLOW_BLOB_S3: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object');
        }
        return parsed as {
          bucket?: string;
          region?: string;
          endpoint?: string;
          forcePathStyle?: boolean;
          accessKeyId?: string;
          secretAccessKey?: string;
          prefix?: string;
        };
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),
  NODE_FLOW_PAYLOAD_THRESHOLD_BYTES: z.coerce.number().int().positive().default(256 * 1024),

  /**
   * Let `HTTP` tasks reach private and loopback addresses.
   *
   * Off by default, and a *deployment* setting rather than a task input — any
   * workflow author could set the latter, and this is the control that stops a
   * definition reaching cloud metadata or an internal admin panel. Turn it on
   * only where every workflow author is trusted.
   */
  NODE_FLOW_HTTP_ALLOW_PRIVATE: boolean(false),
  /** Hosts `HTTP` tasks may always reach, comma-separated. */
  NODE_FLOW_HTTP_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean)
    ),
  NODE_FLOW_SYSTEM_TASK_CONCURRENCY: z.coerce.number().int().positive().default(20),

  /** CPU budget for an `INLINE` script, enforced from inside the sandbox. */
  NODE_FLOW_INLINE_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  NODE_FLOW_INLINE_MEMORY_BYTES: z.coerce.number().int().positive().default(32 * 1024 * 1024),

  // A jq program cannot be interrupted, so this budget is enforced by killing
  // the thread it runs in. See `JqRunner`.
  NODE_FLOW_JQ_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  NODE_FLOW_JQ_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(1024 * 1024),

  /**
   * Databases a `JDBC` task may reach, as `{"name": "postgres://…"}`.
   *
   * Configured by the operator and referenced by name, because a workflow
   * definition is user input: one that could supply its own connection string
   * could point at node-flow's own database and read every namespace's
   * executions and credential hashes. Empty by default, which disables the
   * task entirely — an install that needs none is not exposed at all.
   */
  NODE_FLOW_SQL_DATASOURCES: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object of name to connection string');
        }
        return Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([name, url]) => {
            if (typeof url !== 'string' || url === '') {
              throw new Error(`datasource "${name}" has no connection string`);
            }
            return [name, { url }];
          })
        );
      } catch (error) {
        // A boot failure, not a runtime surprise: a malformed datasource map
        // would otherwise surface as "no datasource configured" on the first
        // workflow that needed one, long after the deploy that broke it.
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  NODE_FLOW_SQL_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  NODE_FLOW_SQL_MAX_ROWS: z.coerce.number().int().positive().default(1_000),

  /**
   * Kafka clusters a `KAFKA_PUBLISH` task may reach, as
   * `{"default": {"brokers": ["host:9092"]}}`.
   *
   * Named and configured by the operator for the same reason as SQL
   * datasources: a workflow definition is user input and must not choose what
   * this server connects to. Empty by default, which leaves Kafka messages
   * dead-lettering visibly rather than appearing to succeed.
   */
  /**
   * gRPC services a `gRPC` task may call, as
   * `{"pricing": {"address":"host:50051","protoPath":"/etc/node-flow/pricing.proto","package":"pricing.v1","service":"Pricing"}}`.
   *
   * Named and configured by the operator, like SQL datasources: a definition
   * that could supply its own address would reach anything inside the
   * perimeter, and `HTTP`'s private-address guard is no defence here because
   * almost every gRPC target is a private address.
   */
  /**
   * Master keys for sealing secrets, as `id:base64key`, newest first.
   *
   * Empty means this install stores no secrets, and says so when asked to —
   * rather than storing them in clear, which is the failure an optional
   * encryption key invites.
   *
   * Two entries is what a rotation looks like in flight: the first seals, the
   * rest still open what they sealed before.
   */
  NODE_FLOW_SECRET_KEYS: z.string().default(''),

  /**
   * OIDC issuers trusted for workload identity, as
   * `[{"issuer":"https://…","jwksUri":"https://…","audience":"node-flow"}]`.
   *
   * Empty disables the mechanism entirely — an install that does not use
   * workload identity should not be reachable by anything presenting a token
   * from an IdP it never chose.
   *
   * The issuer is matched **exactly**. Nothing looser is offered, because a
   * prefix or hostname match is how an IdP nobody configured ends up able to
   * mint tokens for this install.
   */
  NODE_FLOW_OIDC_ISSUERS: z
    .string()
    .default('[]')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('expected a JSON array of issuers');

        return parsed.map((entry) => {
          const issuer = entry as Record<string, unknown>;
          for (const key of ['issuer', 'jwksUri', 'audience']) {
            if (typeof issuer[key] !== 'string' || issuer[key] === '') {
              throw new Error(`each OIDC issuer needs a "${key}"`);
            }
          }
          return issuer as unknown as {
            issuer: string;
            jwksUri: string;
            audience: string;
          };
        });
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  /**
   * Whether to read a client certificate for mTLS authentication.
   *
   * Off by default and separate from TLS itself: reading a peer certificate
   * only means anything when the process actually terminates TLS with a CA
   * bundle, and enabling it behind a proxy that terminates TLS elsewhere would
   * read a certificate that is never there.
   */
  // `boolean()`, not `z.coerce.boolean()`. Coercion follows JavaScript
  // truthiness, under which the *string* "false" is true — so
  // `NODE_FLOW_MTLS_ENABLED=false` switched mTLS on, which is the opposite of
  // what it says and the wrong direction for an authentication control to fail
  // in. The helper accepts only true|false|1|0|yes|no and rejects anything
  // else, which is what every other flag here already used.
  NODE_FLOW_MTLS_ENABLED: boolean(false),

  /**
   * OIDC providers for **human** sign-in, as a JSON array.
   *
   * Distinct from `NODE_FLOW_OIDC_ISSUERS`, which is for workloads: that one
   * verifies a token a platform already minted, this one runs a browser login
   * and needs a client id, a secret and endpoints. Conflating them would mean a
   * machine token could open a human session, or a human login could satisfy a
   * workload binding.
   *
   * Empty disables SSO entirely.
   */
  NODE_FLOW_SSO_PROVIDERS: z
    .string()
    .default('[]')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('expected a JSON array of providers');

        return parsed.map((entry) => {
          const provider = entry as Record<string, unknown>;
          for (const key of [
            'name',
            'issuer',
            'clientId',
            'clientSecret',
            'authorizationEndpoint',
            'tokenEndpoint',
            'jwksUri',
            'redirectUri',
            'namespace',
          ]) {
            if (typeof provider[key] !== 'string' || provider[key] === '') {
              throw new Error(`SSO provider is missing "${key}"`);
            }
          }
          return provider as unknown as {
            name: string;
            issuer: string;
            clientId: string;
            clientSecret: string;
            authorizationEndpoint: string;
            tokenEndpoint: string;
            jwksUri: string;
            redirectUri: string;
            namespace: string;
            scopes?: string;
          };
        });
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  /**
   * SAML 2.0 identity providers for **human** sign-in, as a JSON array.
   *
   * Only the SP-initiated, HTTP-POST-binding flow is supported, and that is a
   * security decision rather than a gap: an IdP-initiated assertion arrives
   * unsolicited, carries no `InResponseTo`, and therefore cannot be bound to
   * the browser that is about to receive the session. See `SamlService`.
   *
   * `idpCert` is the IdP's signing certificate — one PEM, or several during a
   * rotation. `issuer` is *our* entity id as registered there, and
   * `callbackUrl` is the Assertion Consumer Service URL the IdP posts to; both
   * are compared against what the assertion says, so a misconfiguration fails
   * closed instead of accepting an assertion meant for somewhere else.
   *
   * Empty disables SAML entirely.
   */
  NODE_FLOW_SAML_PROVIDERS: z
    .string()
    .default('[]')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error('expected a JSON array of providers');

        return parsed.map((entry) => {
          const provider = entry as Record<string, unknown>;
          for (const key of ['name', 'entryPoint', 'issuer', 'callbackUrl', 'namespace']) {
            if (typeof provider[key] !== 'string' || provider[key] === '') {
              throw new Error(`SAML provider is missing "${key}"`);
            }
          }
          const cert = provider['idpCert'];
          const certs = Array.isArray(cert) ? cert : [cert];
          if (certs.length === 0 || certs.some((value) => typeof value !== 'string' || value === '')) {
            throw new Error('SAML provider is missing "idpCert"');
          }
          return provider as unknown as {
            name: string;
            entryPoint: string;
            issuer: string;
            callbackUrl: string;
            namespace: string;
            idpCert: string | string[];
            emailAttribute?: string;
            nameAttribute?: string;
            privateKey?: string;
            decryptionPvk?: string;
            spCertificate?: string;
            identifierFormat?: string | null;
            signatureAlgorithm?: 'sha256' | 'sha512';
            acceptedClockSkewMs?: number;
          };
        });
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  NODE_FLOW_GRPC_SERVICES: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object of service name to configuration');
        }
        return Object.fromEntries(
          Object.entries(parsed as Record<string, Record<string, unknown>>).map(
            ([name, config]) => {
              for (const key of ['address', 'protoPath', 'package', 'service']) {
                if (typeof config?.[key] !== 'string' || config[key] === '') {
                  throw new Error(`gRPC service "${name}" is missing "${key}"`);
                }
              }
              return [name, config as never];
            }
          )
        );
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  NODE_FLOW_KAFKA_CLUSTERS: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object of cluster name to configuration');
        }
        return Object.fromEntries(
          Object.entries(parsed as Record<string, { brokers?: unknown }>).map(
            ([name, config]) => {
              const brokers = config?.brokers;
              if (!Array.isArray(brokers) || brokers.length === 0) {
                throw new Error(`cluster "${name}" lists no brokers`);
              }
              return [name, { ...config, brokers: brokers.map(String) }];
            }
          )
        );
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  /** `{"default":{"servers":"nats://localhost:4222"}}` — sources `nats:<name>`, sinks `nats:<name>:<subject>`. */
  NODE_FLOW_NATS_CONNECTIONS: brokerConnections<NatsConnectionConfig>('servers'),
  /** `{"default":{"url":"amqp://guest:guest@localhost:5672"}}` — sinks `amqp:<name>:<queue>` or `amqp:<name>:<exchange>/<routingKey>`. */
  NODE_FLOW_AMQP_CONNECTIONS: brokerConnections<AmqpConnectionConfig>('url'),
  /** `{"default":{"region":"us-east-1"}}` — sources `sqs:<name>` consume queues by name, sinks `sqs:<name>:<queue>`. */
  NODE_FLOW_SQS_CONNECTIONS: brokerConnections<SqsConnectionConfig>('region'),
  /** `{"default":{"url":"redis://localhost:6379"}}` — sources `redis:<name>` read streams by name, sinks `redis:<name>:<stream>`. */
  NODE_FLOW_REDIS_CONNECTIONS: brokerConnections<RedisConnectionConfig>('url'),

  /**
   * Circuit breakers for the tasks that call out of the process, as JSON.
   *
   * `{"enabled":true}` is enough; the rest have defaults. Off unless asked for,
   * because a breaker changes how failures behave and that should be a
   * decision, not a surprise after an upgrade.
   *
   * `{"enabled":true,"failureRatio":0.5,"minimumRequests":10,"windowMs":30000,
   * "openMs":5000,"maxOpenMs":60000}`
   */
  NODE_FLOW_CIRCUIT_BREAKER: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object');
        }
        const options = parsed as Record<string, unknown>;
        const ratio = options['failureRatio'];
        if (ratio !== undefined && (typeof ratio !== 'number' || ratio <= 0 || ratio > 1)) {
          throw new Error('"failureRatio" is a fraction above 0 and at most 1');
        }
        for (const key of ['windowMs', 'minimumRequests', 'openMs', 'maxOpenMs']) {
          const value = options[key];
          if (value !== undefined && (typeof value !== 'number' || value <= 0)) {
            throw new Error(`"${key}" must be a positive number`);
          }
        }
        return options as {
          enabled?: boolean;
          windowMs?: number;
          minimumRequests?: number;
          failureRatio?: number;
          openMs?: number;
          maxOpenMs?: number;
        };
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  /**
   * Origins allowed to call the REST gateway from a browser.
   *
   * Empty by default, which means **no** CORS headers and therefore no
   * cross-origin browser access — the safe default, because a gateway route
   * runs a workflow and the wrong origin list is a way for someone else's page
   * to do that with a visitor's credentials.
   *
   * Exact origins only. `*` is deliberately not special-cased: it cannot be
   * combined with credentials anyway, and an install that means "anyone" should
   * say so origin by origin, or put a proxy in front that owns the policy.
   */
  NODE_FLOW_GATEWAY_CORS_ORIGINS: z
    .string()
    .default('')
    .transform((raw) =>
      raw
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== '')
    ),

  /**
   * SMTP transports the `EMAIL` task may use, as JSON.
   *
   * `{"default":{"host":"smtp.example.com","port":587,"user":"…","pass":"…","from":"ops@example.com"}}`
   *
   * Operator configuration rather than task input, for the reason the `JDBC`
   * datasources are: a definition is stored, versioned and rendered in a UI, and
   * one carrying a mail server's credentials puts them all three places.
   */
  NODE_FLOW_SMTP_TRANSPORTS: z
    .string()
    .default('{}')
    .transform((raw, ctx) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('expected a JSON object of transport name to configuration');
        }
        for (const [name, config] of Object.entries(parsed as Record<string, { host?: unknown }>)) {
          if (typeof config?.host !== 'string' || config.host === '') {
            throw new Error(`SMTP transport "${name}" is missing "host"`);
          }
        }
        return parsed as Record<string, SmtpTransportConfig>;
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: (error as Error).message });
        return z.NEVER;
      }
    }),

  /** Upper bound on a worker's long-poll, so a held connection is never unbounded. */
  NODE_FLOW_MAX_POLL_SECONDS: seconds(30),
  NODE_FLOW_DEFAULT_LEASE_SECONDS: seconds(60),
})
  // Checked here rather than where the store is built: a bucketless `s3`
  // setting fails at boot with the rest of the configuration, instead of at
  // the first payload large enough to offload — which could be days later.
  .superRefine((config, ctx) => {
    if (config.NODE_FLOW_BLOB_STORE === 's3' && !config.NODE_FLOW_BLOB_S3.bucket) {
      ctx.addIssue({
        code: 'custom',
        path: ['NODE_FLOW_BLOB_S3'],
        message: 'NODE_FLOW_BLOB_STORE=s3 needs NODE_FLOW_BLOB_S3 to name a "bucket"',
      });
    }
  });

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Validates the environment, or throws with every problem at once.
 *
 * Reporting all failures together matters more than it sounds: fixing
 * misconfiguration one restart at a time is how a five-minute deploy becomes an
 * hour.
 */
export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (parsed.success) return parsed.data;

  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${problems}`);
}

import { TaskType, type JsonValue } from '@node-flow-dev/core';
import type { TaskContext, TaskExecutor, TaskOutcome } from './executor.js';

/**
 * `EMAIL` — sends a message over SMTP.
 *
 * ## Why this is a task and not an HTTP call
 *
 * It could be one: every provider has a REST API, and `HTTP` would reach it.
 * What that loses is the thing worth having — the *address book*. A definition
 * calling SendGrid carries an endpoint, an API key reference and a
 * provider-shaped body, so moving to SES means editing every workflow that
 * sends mail. Here the transport is operator configuration named by the task,
 * and a definition says only who, what and why.
 *
 * SMTP rather than one vendor's API for the same reason: it is the one
 * interface every provider speaks, so SES, SendGrid, Postmark, Mailgun and the
 * relay in someone's data centre are all `NODE_FLOW_SMTP_TRANSPORTS` entries
 * rather than five executors.
 *
 * `nodemailer` is an **optional peer**, like the broker clients. An install
 * that sends no mail never loads it, and asking for a transport that was never
 * configured says so by name rather than failing at connect time.
 *
 * ## What is deliberately not here
 *
 * No templating. `${...}` expressions already interpolate the subject and body
 * before this task ever runs, and a second template language inside the task
 * would mean two syntaxes, two escaping rules and two places to look when the
 * wrong name appears in someone's inbox.
 */

export interface SmtpTransportConfig {
  host: string;
  port?: number;
  /** Implicit TLS (465). Port 587 negotiates STARTTLS and leaves this false. */
  secure?: boolean;
  user?: string;
  pass?: string;
  /** The default `From`, so a definition need not repeat it. */
  from?: string;
  /** Refuse to send at all — for a staging install that must never mail a customer. */
  disabled?: boolean;
}

export interface EmailExecutorOptions {
  /** Transports by name, from operator configuration. Empty disables the task. */
  transports?: Record<string, SmtpTransportConfig>;
  /** Overrides transport construction, for tests. */
  createTransport?: (config: SmtpTransportConfig) => Promise<MailTransport>;
}

/** The slice of a nodemailer transport this uses. */
export interface MailTransport {
  sendMail(message: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>;
  close?(): void;
}

interface NodemailerModule {
  createTransport(options: Record<string, unknown>): MailTransport;
}

const MAX_RECIPIENTS = 100;

export class EmailTaskExecutor implements TaskExecutor {
  readonly type = TaskType.EMAIL;
  /** One transport per configured name: a connection pool is worth reusing. */
  private readonly transports = new Map<string, Promise<MailTransport>>();

  constructor(private readonly options: EmailExecutorOptions = {}) {}

  async execute(context: TaskContext): Promise<TaskOutcome> {
    const input = context.input;
    const configured = this.options.transports ?? {};

    const name = typeof input['transport'] === 'string' && input['transport'] !== ''
      ? input['transport']
      : Object.keys(configured)[0];

    if (!name || !configured[name]) {
      const known = Object.keys(configured);
      return {
        status: 'FAILED',
        reason: known.length
          ? `no SMTP transport "${name}" is configured; available: ${known.join(', ')}`
          : 'this install has no SMTP transport configured, so EMAIL cannot send',
        terminal: true,
      };
    }

    const config = configured[name];
    if (config.disabled) {
      // Not a silent success: a staging install that quietly swallows mail
      // teaches everyone that the task works, and the surprise arrives in
      // production.
      return { status: 'FAILED', reason: `SMTP transport "${name}" is disabled on this install`, terminal: true };
    }

    const to = recipients(input['to']);
    if (to.length === 0) return { status: 'FAILED', reason: 'EMAIL requires "to"', terminal: true };
    if (to.length > MAX_RECIPIENTS) {
      return { status: 'FAILED', reason: `EMAIL sends to at most ${MAX_RECIPIENTS} recipients at once`, terminal: true };
    }

    const from = typeof input['from'] === 'string' && input['from'] !== '' ? input['from'] : config.from;
    if (!from) {
      return { status: 'FAILED', reason: `EMAIL needs "from", or a default on transport "${name}"`, terminal: true };
    }

    const subject = typeof input['subject'] === 'string' ? input['subject'] : '';
    const text = typeof input['body'] === 'string' ? input['body'] : typeof input['text'] === 'string' ? input['text'] : undefined;
    const html = typeof input['html'] === 'string' ? input['html'] : undefined;
    if (text === undefined && html === undefined) {
      return { status: 'FAILED', reason: 'EMAIL requires "body" (text) or "html"', terminal: true };
    }

    try {
      const transport = await this.transportFor(name, config);
      const result = await transport.sendMail({
        from,
        to: to.join(', '),
        ...(recipients(input['cc']).length ? { cc: recipients(input['cc']).join(', ') } : {}),
        ...(recipients(input['bcc']).length ? { bcc: recipients(input['bcc']).join(', ') } : {}),
        ...(typeof input['replyTo'] === 'string' ? { replyTo: input['replyTo'] } : {}),
        subject,
        ...(text !== undefined ? { text } : {}),
        ...(html !== undefined ? { html } : {}),
      });

      return {
        status: 'COMPLETED',
        output: {
          messageId: result.messageId ?? null,
          accepted: (result.accepted ?? []).map(String),
          rejected: (result.rejected ?? []).map(String),
          transport: name,
        },
      };
    } catch (error) {
      const message = (error as Error).message;
      return {
        status: 'FAILED',
        reason: `sending mail through "${name}" failed: ${message}`,
        terminal: isPermanent(error),
      };
    }
  }

  private async transportFor(name: string, config: SmtpTransportConfig): Promise<MailTransport> {
    let pending = this.transports.get(name);
    if (!pending) {
      pending = (this.options.createTransport ?? defaultTransport)(config).catch((error: unknown) => {
        // Not cached on failure, or one bad startup would poison the transport
        // for the lifetime of the process.
        this.transports.delete(name);
        throw error;
      });
      this.transports.set(name, pending);
    }
    return pending;
  }

  /** Closes pooled connections. Called on shutdown. */
  async close(): Promise<void> {
    for (const pending of this.transports.values()) {
      await pending.then((transport) => transport.close?.()).catch(() => undefined);
    }
    this.transports.clear();
  }
}

async function defaultTransport(config: SmtpTransportConfig): Promise<MailTransport> {
  let nodemailer: NodemailerModule;
  try {
    nodemailer = (await import('nodemailer')) as unknown as NodemailerModule;
  } catch {
    throw new Error('the EMAIL task needs the "nodemailer" package, which is not installed');
  }

  const create = nodemailer.createTransport ?? (nodemailer as unknown as { default: NodemailerModule }).default?.createTransport;
  return create({
    host: config.host,
    port: config.port ?? 587,
    secure: config.secure ?? false,
    ...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
    // Pooled: a workflow that mails on every run would otherwise open a
    // connection per task, which is what gets an install rate-limited.
    pool: true,
    maxConnections: 3,
  });
}

/**
 * Whether SMTP refused the message for good.
 *
 * A 5xx means "this will be refused again" — a bad address, a rejected sender —
 * and retrying it burns the whole budget to deliver the same error later. A 4xx
 * or a connection problem is exactly what retries are for.
 *
 * Read from `responseCode` where the client supplies it, and otherwise from a
 * code at the **start** of the message. Searching the text for any three digits
 * beginning with 5 is the obvious version and it is wrong: `connect
 * ECONNREFUSED 10.0.0.1:587` contains one, in the port, and a transient network
 * failure would be classified as permanent and never retried.
 */
function isPermanent(error: unknown): boolean {
  const code = (error as { responseCode?: unknown }).responseCode;
  if (typeof code === 'number') return code >= 500 && code < 600;

  // An SMTP reply begins with its code: "550 5.1.1 recipient rejected".
  return /^5\d\d(?:[ -]|$)/.test((error as Error).message ?? '');
}

/** Recipients as a list, however the definition wrote them. */
function recipients(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((address) => address.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
  }
  return [];
}

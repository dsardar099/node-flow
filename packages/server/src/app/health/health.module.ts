import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DecideQueueRepository, pendingMigrations, ping, type Db } from '@node-flow-dev/store';
import { DB } from '../database/database.module.js';
import { Public } from '../auth/auth.decorators.js';

/**
 * Liveness and readiness.
 *
 * `@nestjs/terminus` is deliberately not used. Its database indicators are all
 * ORM-bound — TypeORM, Sequelize, Mongoose, Prisma — and we use none of them,
 * so we would be writing a custom indicator anyway while inheriting fifteen
 * optional peer dependencies for the response envelope. That envelope is the
 * forty lines below.
 *
 * The distinction between the two probes is the part worth getting right,
 * because conflating them causes outages rather than preventing them:
 *
 *  - **Liveness** asks "is this process wedged?" It must not touch the
 *    database. A shared Postgres blip would otherwise fail liveness on every
 *    replica at once and the orchestrator would restart the entire fleet —
 *    turning a recoverable dependency failure into a full outage.
 *  - **Readiness** asks "should traffic come here?" It checks the database,
 *    because a replica that cannot reach Postgres can serve nothing useful.
 */

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly decideQueue: DecideQueueRepository
  ) {}

  async readiness(): Promise<{ ok: boolean; checks: HealthCheck[] }> {
    const checks = await Promise.all([this.checkDatabase(), this.checkMigrations()]);
    return { ok: checks.every((check) => check.ok), checks };
  }

  /**
   * Operational depth counters.
   *
   * Reported separately from readiness on purpose. A deep queue means the
   * system is behind, not that this replica is broken — failing readiness on it
   * would remove capacity at exactly the moment more is needed.
   */
  async depth(): Promise<{ decideQueue: number }> {
    return { decideQueue: await this.decideQueue.depth() };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    return this.timed('database', () => ping(this.db));
  }

  /**
   * Whether the schema is at the revision this build expects.
   *
   * A replica running against a half-migrated database is worse than one that
   * is simply down: it accepts traffic and fails in ways that look like data
   * corruption.
   */
  private async checkMigrations(): Promise<HealthCheck> {
    return this.timed('migrations', async () => {
      const pending = await pendingMigrations(this.db);
      if (pending.length > 0) {
        // Named, not counted. A deploy that rolls out the binary before the
        // migration is the usual cause, and the operator needs to know which
        // migration to run — not that some number of them are missing.
        throw new Error(`schema behind build: ${pending.join(', ')} not applied`);
      }
      return 'schema up to date';
    });
  }

  private async timed(
    name: string,
    check: () => Promise<string | void>
  ): Promise<HealthCheck> {
    const started = Date.now();
    try {
      const detail = await check();
      return { name, ok: true, ...(detail ? { detail } : {}), durationMs: Date.now() - started };
    } catch (error) {
      return {
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      };
    }
  }
}

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Process-level only. Never touches a dependency — see the module comment. */
  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  @Public()
  @Get('ready')
  async ready() {
    const result = await this.health.readiness();

    // A failing readiness probe must be a non-2xx, or every orchestrator will
    // read the 200 and keep routing traffic here regardless of the body.
    if (!result.ok) {
      throw new ServiceUnavailableException({ status: 'unavailable', ...result });
    }

    return { status: 'ok', ...result };
  }

  @Public()
  @Get()
  async summary() {
    const [readiness, depth] = await Promise.all([
      this.health.readiness(),
      this.health.depth().catch(() => ({ decideQueue: -1 })),
    ]);

    return {
      status: readiness.ok ? 'ok' : 'degraded',
      checks: readiness.checks,
      queues: depth,
    };
  }
}

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}

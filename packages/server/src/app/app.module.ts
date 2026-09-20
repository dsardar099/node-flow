import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { DomainErrorFilter } from './common/domain-error.filter.js';
import { HttpShutdownService } from './common/http-shutdown.service.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { ExecutionModule } from './execution/execution.module.js';
import { HealthModule } from './health/health.module.js';
import { MetadataModule } from './metadata/metadata.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { OpenApiModule } from './openapi/openapi.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RunnerModule } from './runner/runner.module.js';
import { WebhookModule } from './webhook/webhook.module.js';
import { HumanModule } from './human/human.module.js';
import { EventsModule } from './events/events.module.js';
import { ScheduleModule } from './schedule/schedule.module.js';
import { AuditModule } from './audit/audit.module.js';
import { QuotasModule } from './quotas/quotas.module.js';
import { SemaphoresModule } from './semaphores/semaphores.module.js';
import { SsoModule } from './sso/sso.module.js';
import { WorkloadModule } from './workload/workload.module.js';
import { AuditInterceptor } from './common/audit.interceptor.js';
import { AuditSnapshots } from './common/audit-snapshots.js';
import { GroupsModule } from './groups/groups.module.js';
import { SecretsModule } from './secrets/secrets.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { EnvironmentModule } from './environment/environment.module.js';
import { SchemasModule } from './schemas/schemas.module.js';
import { FormsModule } from './forms/forms.module.js';
import { TagsModule } from './tags/tags.module.js';
import { HooksModule } from './hooks/hooks.module.js';
import { SimulationModule } from './simulation/simulation.module.js';
import { StatusListenersModule } from './status-listeners/status-listeners.module.js';
import { SavedViewsModule } from './saved-views/saved-views.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { AiModule } from './ai/ai.module.js';
import { ApiGatewayModule } from './api-gateway/api-gateway.module.js';
import { AssistantModule } from './assistant/assistant.module.js';
import { NamespaceModule } from './namespaces/namespaces.module.js';
import { McpGatewayModule } from './mcp-gateway/mcp-gateway.module.js';
import { ConductorModule } from './conductor/conductor.module.js';

/**
 * Import order is load-bearing.
 *
 * Nest initialises modules in import order and runs shutdown hooks in reverse,
 * so `DatabaseModule` early means it migrates before anything can query, and
 * its pool closes *after* `RunnerModule` has stopped every loop. Reverse the
 * two and shutdown pulls the connections out from under an in-flight
 * transaction, leaving claimed-but-unpublished outbox events behind.
 *
 * There is exactly one global guard, in `AuthModule`. An earlier version had a
 * second one here for the namespace check, and their relative order was Nest's
 * to decide — which meant the namespace guard could run before a principal
 * existed, and allowed the request when it did. See `AuthGuard`.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    HealthModule,
    MetadataModule,
    OpenApiModule,
    ExecutionModule,
    QueueModule,
    WebhookModule,
    RunnerModule,
    // After RunnerModule: the metrics gauges read its stats.
    MetricsModule,
    HumanModule,
    ScheduleModule,
    EventsModule,
    SecretsModule,
    GroupsModule,
    AuditModule,
    QuotasModule,
    SemaphoresModule,
    WorkloadModule,
    SsoModule,
    RealtimeModule,
    EnvironmentModule,
    SchemasModule,
    FormsModule,
    TagsModule,
    HooksModule,
    SimulationModule,
    StatusListenersModule,
    SavedViewsModule,
    PermissionsModule,
    AiModule,
    McpGatewayModule,
    ApiGatewayModule,
    AssistantModule,
    NamespaceModule,
    ConductorModule,
  ],
  providers: [
    // Records every control-plane change. Global, because an audit log whose
    // completeness depends on each author remembering a line has holes in it.
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Catches everything, so a domain error becomes its mapped status rather
    // than a 500, from any controller, without a try/catch in sight.
    { provide: APP_FILTER, useClass: DomainErrorFilter },
    HttpShutdownService,
    AuditSnapshots,
  ],
})
export class AppModule {}

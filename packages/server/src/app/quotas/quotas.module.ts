import { Body, Controller, Get, HttpCode, Module, Put } from '@nestjs/common';
import { Scope, type Principal } from '@node-flow-dev/core';
import { QuotaService, type NamespaceQuotas } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Per-tenant quotas.
 *
 * `admin`-scoped, because a tenant that could raise its own limits does not
 * have limits.
 */

const quotaSchema = z.object({
  maxConcurrentExecutions: z.number().int().min(0).optional(),
  maxExecutionsPerMinute: z.number().int().min(0).optional(),
  maxWorkflowDefinitions: z.number().int().min(0).optional(),
  maxSchedules: z.number().int().min(0).optional(),
});

@Controller('ns/:ns/quotas')
export class QuotaController {
  constructor(private readonly quotas: QuotaService) {}

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Read this namespace’s quotas',
    description: 'An absent value means unlimited, which is the default.',
    tags: ['quotas'],
  })
  async get(@CurrentPrincipal() principal: Principal): Promise<NamespaceQuotas> {
    return this.quotas.quotasFor(principal.namespaceId);
  }

  @Put()
  @HttpCode(200)
  @RequireScopes(Scope.ADMIN)
  @Audited('quota', 'set')
  @ApiRoute({
    summary: 'Replace this namespace’s quotas',
    description:
      'Omitting a value leaves it unlimited. Quotas are enforced at the front ' +
      'door — starting a workflow, registering a definition, creating a ' +
      'schedule — because shedding at admission is the only load-shedding that ' +
      'leaves in-flight work intact.',
    tags: ['quotas'],
    body: quotaSchema,
  })
  async set(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(quotaSchema)) body: z.infer<typeof quotaSchema>
  ): Promise<NamespaceQuotas> {
    return this.quotas.setQuotas(principal.namespaceId, body);
  }
}

@Module({ controllers: [QuotaController] })
export class QuotasModule {}

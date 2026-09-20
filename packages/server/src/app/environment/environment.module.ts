import { Body, Controller, Delete, Get, HttpCode, Module, Param, Put } from '@nestjs/common';
import { Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import { EnvironmentRepository, type EnvironmentVariable } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Environment variables: configuration a definition reads as
 * `${workflow.env.name}`.
 *
 * Distinct from secrets on purpose. A variable is shown in clear, can hold
 * JSON, is resolved when the decider schedules a task — so a SWITCH or a loop
 * condition can branch on it — and is managed by whoever may edit workflows.
 * A secret is none of those things, and a credential must never be stored here.
 */
const putSchema = z.object({
  type: z.enum(['TEXT', 'JSON']).default('TEXT'),
  value: z.unknown(),
  description: z.string().max(1000).optional(),
});

@Controller('ns/:ns/environment')
export class EnvironmentController {
  constructor(private readonly environment: EnvironmentRepository) {}

  @Get()
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({ summary: 'List environment variables', tags: ['environment'] })
  async list(@CurrentPrincipal() principal: Principal) {
    return { variables: (await this.environment.list(principal.namespaceId)).map(present) };
  }

  @Audited('environment-variable', 'put')
  @Put(':name')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Create or replace an environment variable',
    description: 'Takes effect for tasks scheduled after the change, within a few seconds on every replica.',
    tags: ['environment'],
    body: putSchema,
  })
  async put(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(putSchema)) body: z.infer<typeof putSchema>
  ) {
    return present(
      await this.environment.put(principal.namespaceId, {
        name,
        type: body.type,
        value: (body.value ?? null) as JsonValue,
        description: body.description,
        updatedBy: principal.id,
      })
    );
  }

  @Audited('environment-variable', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({ summary: 'Delete an environment variable', tags: ['environment'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    await this.environment.delete(principal.namespaceId, name);
  }
}

function present(variable: EnvironmentVariable) {
  return variable;
}

@Module({ controllers: [EnvironmentController] })
export class EnvironmentModule {}

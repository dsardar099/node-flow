import { Body, Controller, Delete, Get, HttpCode, Module, Param, Put } from '@nestjs/common';
import { ErrorCode, NodeFlowError, Scope, type Principal } from '@node-flow-dev/core';
import { ConcurrencyRepository, type SemaphoreState } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Named semaphores.
 *
 * The dispatcher has always honoured these — a task definition lists the
 * semaphores it must hold, and `ConcurrencyRepository` refuses to hand it out
 * when they are full. What was missing was any way to *configure* one: permits
 * could only be set from a repository call that nothing outside the tests ever
 * made.
 *
 * That made the feature worse than absent. An unconfigured semaphore does not
 * gate, by design — so a task definition could declare one, register without
 * complaint, and run completely ungated. Declaring a limit and silently getting
 * none is the failure mode every control here is written to avoid.
 *
 * `admin`-scoped, for the same reason quotas are: a tenant that can raise its
 * own cap does not have one.
 */

const permitsSchema = z.object({
  /**
   * At least one. Zero would read as "block everything", which is a thing
   * people will reach for during an incident and then be unable to distinguish
   * from a bug — deleting the semaphore, or pausing the workflows, says what is
   * meant.
   */
  permits: z.number().int().min(1).max(10_000),
});

const NAME = z.string().min(1).max(200);

@Controller('ns/:ns/semaphores')
export class SemaphoreController {
  constructor(private readonly concurrency: ConcurrencyRepository) {}

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Every semaphore in this namespace',
    description:
      'With the number of permits currently held, because a semaphore sitting ' +
      'at its limit looks exactly like one nobody uses — and "why is my task ' +
      'not running?" should be answerable from here.',
    tags: ['semaphores'],
  })
  async list(@CurrentPrincipal() principal: Principal): Promise<{ semaphores: SemaphoreState[] }> {
    return { semaphores: await this.concurrency.listSemaphores(principal.namespaceId) };
  }

  @Get(':name')
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'One semaphore', tags: ['semaphores'] })
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string
  ): Promise<SemaphoreState> {
    const semaphore = await this.concurrency.getSemaphore(principal.namespaceId, NAME.parse(name));
    if (!semaphore) {
      // Named explicitly: an unconfigured semaphore does not gate, so silence
      // here would be indistinguishable from a limit that is being enforced.
      throw new NodeFlowError(
        ErrorCode.NOT_FOUND,
        `semaphore "${name}" is not configured, so it gates nothing`,
        { name }
      );
    }
    return semaphore;
  }

  @Put(':name')
  @HttpCode(200)
  @RequireScopes(Scope.ADMIN)
  @Audited('semaphore', 'set')
  @ApiRoute({
    summary: 'Create a semaphore or change its size',
    description:
      'Tasks name the semaphores they need on their task definition; this is ' +
      'what decides how many may hold one at a time. Lowering it never revokes ' +
      'a permit already held — the holders drain, and the new size applies to ' +
      'whoever asks next.',
    tags: ['semaphores'],
    body: permitsSchema,
  })
  async set(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(permitsSchema)) body: z.infer<typeof permitsSchema>
  ): Promise<SemaphoreState> {
    const parsed = NAME.parse(name);
    await this.concurrency.configureSemaphore(principal.namespaceId, parsed, body.permits);
    return (
      (await this.concurrency.getSemaphore(principal.namespaceId, parsed)) ?? {
        name: parsed,
        permits: body.permits,
        held: 0,
      }
    );
  }

  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @Audited('semaphore', 'delete')
  @ApiRoute({
    summary: 'Stop a semaphore gating anything',
    description:
      'Removes the configuration. This releases nothing: a permit is held by a ' +
      'running task and is given up when that task finishes or its lease ' +
      'expires, so deleting during an incident lets *more* through, not less.',
    tags: ['semaphores'],
  })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string): Promise<void> {
    const removed = await this.concurrency.deleteSemaphore(principal.namespaceId, NAME.parse(name));
    if (!removed) {
      throw new NodeFlowError(ErrorCode.NOT_FOUND, `no semaphore "${name}"`, { name });
    }
  }
}

@Module({ controllers: [SemaphoreController] })
export class SemaphoresModule {}

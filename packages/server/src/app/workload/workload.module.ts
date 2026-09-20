import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ErrorCode, Scope, type Principal } from '@node-flow-dev/core';
import { WorkloadIdentityRepository, type WorkloadBinding } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Binding externally-vouched identities to service accounts.
 *
 * `admin`-scoped, because a binding grants everything the service account can
 * do to whoever holds the certificate or can obtain the token — it is the same
 * privilege as issuing a credential, without issuing one.
 */

const bindSchema = z.object({
  serviceAccount: z.string().min(1),
  kind: z.enum(['mtls', 'oidc']),
  /** The CA's distinguished name, or the IdP's `iss`. Matched exactly. */
  issuer: z.string().min(1),
  /** The certificate subject or SPIFFE URI, or the token's `sub`. */
  subject: z.string().min(1),
  description: z.string().max(1000).optional(),
});

@Controller('ns/:ns/workload-identities')
export class WorkloadIdentityController {
  constructor(private readonly identities: WorkloadIdentityRepository) {}

  @Post()
  @HttpCode(201)
  @RequireScopes(Scope.ADMIN)
  @Audited('workload-identity', 'bind')
  @ApiRoute({
    summary: 'Bind a certificate or workload token to a service account',
    description:
      'Explicit by design: a certificate whose CN matches a service account ' +
      'name proves nothing. The CA or IdP decides who you are; this decides ' +
      'what that identity may do.',
    tags: ['auth'],
    body: bindSchema,
  })
  async bind(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(bindSchema)) body: z.infer<typeof bindSchema>
  ) {
    return present(
      await this.identities.bind({
        namespaceId: principal.namespaceId,
        serviceAccountName: body.serviceAccount,
        kind: body.kind,
        issuer: body.issuer,
        subject: body.subject,
        description: body.description,
        by: principal.id,
      })
    );
  }

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'List workload identity bindings',
    description:
      '`lastSeenAt` answers the question asked before removing one: is anything ' +
      'still using it?',
    tags: ['auth'],
  })
  async list(@CurrentPrincipal() principal: Principal) {
    return { identities: (await this.identities.list(principal.namespaceId)).map(present) };
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @Audited('workload-identity', 'unbind')
  @ApiRoute({ summary: 'Remove a binding', tags: ['auth'] })
  async unbind(@CurrentPrincipal() principal: Principal, @Param('id') id: string) {
    if (!(await this.identities.unbind(principal.namespaceId, id))) {
      throw new NotFoundException({
        error: ErrorCode.NOT_FOUND,
        message: `no workload identity ${id}`,
      });
    }
  }
}

function present(binding: WorkloadBinding) {
  return {
    id: binding.id,
    serviceAccountId: binding.serviceAccountId,
    kind: binding.kind,
    issuer: binding.issuer,
    subject: binding.subject,
    description: binding.description,
    lastSeenAt: binding.lastSeenAt,
    createdAt: binding.createdAt,
  };
}

@Module({ controllers: [WorkloadIdentityController] })
export class WorkloadModule {}

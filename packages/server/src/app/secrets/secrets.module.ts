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
  Put,
} from '@nestjs/common';
import { ErrorCode, Scope, type Principal } from '@node-flow-dev/core';
import { SecretRepository, type SecretSummary } from '@node-flow-dev/store';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { zodBody } from '../common/zod.pipe.js';
import { Audited } from '../common/audit.interceptor.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Secrets and environment variables.
 *
 * **There is deliberately no endpoint that returns a sealed value.** Not for an
 * admin, not for the owner, not with a confirmation. An endpoint that returns a
 * secret turns every over-broad credential, every logging middleware and every
 * screen-share into a credential disclosure — and anyone who genuinely needs
 * the value already has it, while anyone who does not needs a rotation instead.
 *
 * Writing one requires `admin` rather than `workflows:write`: a credential is
 * not a workflow, and the people who edit definitions are usually not the
 * people who hold production credentials.
 */

const putSchema = z.object({
  value: z.string().min(1).max(64 * 1024),
  description: z.string().max(1000).optional(),
  /** false stores a plain environment variable, which is readable. */
  sealed: z.boolean().optional(),
});

@Controller('ns/:ns/secrets')
export class SecretController {
  constructor(private readonly secrets: SecretRepository) {}

  @Audited('secret', 'put')
  @Put(':name')
  @HttpCode(200)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Create or replace a secret',
    description:
      'Idempotent, because rotating a credential is the common operation and ' +
      'splitting it into create-then-update invites a window where it is absent.',
    tags: ['secrets'],
    body: putSchema,
  })
  async put(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(putSchema)) body: z.infer<typeof putSchema>
  ) {
    return present(
      await this.secrets.put({
        namespaceId: principal.namespaceId,
        name,
        value: body.value,
        description: body.description,
        sealed: body.sealed,
        by: principal.id,
      })
    );
  }

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'List secret names',
    description: 'Names and metadata only. A sealed value is never returned.',
    tags: ['secrets'],
  })
  async list(@CurrentPrincipal() principal: Principal) {
    return { secrets: (await this.secrets.list(principal.namespaceId)).map(present) };
  }

  @Audited('secret', 'delete')
  @Delete(':name')
  @HttpCode(204)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'Delete a secret', tags: ['secrets'] })
  async remove(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    if (!(await this.secrets.delete(principal.namespaceId, name))) {
      throw new NotFoundException({
        error: ErrorCode.NOT_FOUND,
        message: `no secret "${name}"`,
      });
    }
  }

  @Audited('secret', 'rotate')
  @Post('rotate')
  @HttpCode(200)
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Re-seal secrets under the active master key',
    description:
      'What a key rotation consists of: each secret’s data key is re-wrapped, ' +
      'so rotation costs one small write per secret rather than re-encrypting ' +
      'every value. Safe to call repeatedly; already-current secrets are skipped.',
    tags: ['secrets'],
  })
  async rotate() {
    return this.secrets.rotate();
  }
}

function present(secret: SecretSummary) {
  return {
    name: secret.name,
    description: secret.description,
    sealed: secret.sealed,
    // Present only for a variable. A sealed value has no representation here.
    ...(secret.sealed ? {} : { value: secret.value }),
    keyId: secret.keyId,
    createdBy: secret.createdBy,
    updatedBy: secret.updatedBy,
    createdAt: secret.createdAt,
    updatedAt: secret.updatedAt,
  };
}

@Module({ controllers: [SecretController] })
export class SecretsModule {}

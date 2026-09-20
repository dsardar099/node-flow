import {
  BadRequestException,
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
  Query,
} from '@nestjs/common';
import {
  ErrorCode,
  NodeFlowError,
  Scope,
  taskDefinitionSchema,
  workflowDefinitionSchema,
  type Principal,
} from '@node-flow-dev/core';
import { importBpmn } from '@node-flow-dev/bpmn';
import { MetadataRepository, QuotaService, checkDefinition, exportDefinitions, importDefinitions } from '@node-flow-dev/store';
import { z } from 'zod';
import { AllowResourceGrant, CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { accessPolicy, mayUse } from '../common/access-policy.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';
import { Audited } from '../common/audit.interceptor.js';
import { zodBody } from '../common/zod.pipe.js';

/**
 * Workflow and task definitions.
 *
 * Definitions are validated *and compiled* on registration, so a definition
 * that cannot run is a 400 at deploy time rather than a workflow that fails at
 * 3am on the one branch nobody exercised. The compiler catches the referential
 * errors a schema cannot: a task reading `${missing.output.x}`, a fork with no
 * join, a switch naming a branch that does not exist.
 */

const tagsSchema = z.object({ tags: z.array(z.string()).max(50) });

const versionParam = z.coerce.number().int().positive().optional();

const bpmnImportSchema = z.object({
  /** The .bpmn file's contents. Two megabytes is a very large process diagram. */
  xml: z.string().min(1).max(2_000_000),
  /** Which process to import, when the document holds several. */
  processId: z.string().min(1).max(200).optional(),
});

const exportSchema = z.object({
  workflows: z.array(z.string().min(1).max(200)).max(500).optional(),
  versions: z.enum(['latest', 'all']).optional(),
  includeDependencies: z.boolean().optional(),
});

const importSchema = z.object({
  bundle: z.record(z.string(), z.unknown()),
  workflowConflicts: z.enum(['skip', 'new-version']).optional(),
  taskDefinitionConflicts: z.enum(['skip', 'overwrite']).optional(),
  dryRun: z.boolean().optional(),
});

@Controller('ns/:ns/metadata')
export class MetadataController {
  constructor(
    private readonly metadata: MetadataRepository,
    private readonly quotas: QuotaService
  ) {}

  /**
   * Registers a workflow definition.
   *
   * The body is passed through unvalidated by the pipe and validated by the
   * repository instead — deliberately. `workflowDefinitionSchema` lives in
   * `core` and is the DSL's single definition; re-declaring it here as a DTO is
   * exactly the duplication that lets an API and an engine drift apart.
   */
  @Audited('workflow', 'register')
  @Post('workflows')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'UPDATE')
  @ApiRoute({
    summary: 'Register a workflow definition',
    description:
      'Validated and compiled on registration, so a definition that cannot run is a ' +
      '400 at deploy time rather than a failure at 3am on an unexercised branch. ' +
      'Versions are immutable once registered.',
    tags: ['metadata'],
    body: workflowDefinitionSchema,
  })
  async registerWorkflow(
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown
  ) {
    // Counted before the write, so a runaway CI pipeline registering a new
    // definition per commit is stopped at the door rather than discovered later.
    await this.quotas.assertMayCreate(principal.namespaceId, 'maxWorkflowDefinitions');

    const { definition, blueprint } = await this.metadata.registerWorkflow({
      // From the credential, never the URL — see `assertNamespace`.
      namespaceId: principal.namespaceId,
      definition: body,
      createdBy: principal.name,
      tags: tagsOf(body),
      access: accessPolicy(principal),
    });

    return {
      name: definition.name,
      version: definition.version,
      // Returning the compiled shape makes registration self-verifying: the
      // caller sees the task count and entry point the engine actually derived,
      // not merely that their JSON was accepted.
      compiled: {
        entryRef: blueprint.entryRef,
        taskCount: blueprint.size,
        timeoutSeconds: blueprint.timeoutSeconds,
        maxConcurrentExecutions: blueprint.maxConcurrentExecutions,
      },
    };
  }

  /**
   * Validates and compiles a definition without registering it.
   *
   * A 200 carrying a verdict rather than a 400, because the request did not
   * fail: asking "is this valid?" and being told "no, here is why" is the
   * endpoint working. Reserving 400 for a malformed *request* keeps an editor
   * that validates on every keystroke from filling a console with errors.
   *
   * Runs the exact function registration runs, so "valid" here means
   * registration will accept it — the only promise that makes a dry run worth
   * having.
   */
  @Post('workflows/validate')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @HttpCode(200)
  @ApiRoute({
    summary: 'Validate and compile a workflow definition without registering it',
    description:
      'Returns a verdict, not an error: `valid`, and on failure the issues with a ' +
      'path or task reference locating each one. Uses the same check as registration.',
    tags: ['metadata'],
  })
  async validateWorkflow(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const checked = checkDefinition(body);

    // The version a save would need, when the name already exists and the
    // caller can reach it. Versions are immutable, so an editor that offers to
    // "save" version 3 over an existing version 3 is offering a guaranteed
    // failure. Omitted for an unreachable name, so this cannot be used to probe
    // which tagged workflows exist.
    const name = typeof (body as { name?: unknown })?.name === 'string'
      ? (body as { name: string }).name
      : undefined;
    let latestVersion: number | undefined;
    if (name) {
      const tags = await this.metadata.tagsOf(principal.namespaceId, name);
      if (!tags || mayUse(principal, 'READ', { name, tags })) {
        latestVersion = await this.metadata.latestVersion(principal.namespaceId, name);
      }
    }

    if (!checked.valid) {
      return { valid: false, stage: checked.stage, issues: checked.issues, latestVersion };
    }

    return {
      valid: true,
      issues: [],
      latestVersion,
      compiled: {
        entryRef: checked.blueprint.entryRef,
        taskCount: checked.blueprint.size,
      },
    };
  }

  /**
   * Converts a BPMN 2.0 file into a definition to review.
   *
   * Deliberately **not** a registration. BPMN is a graph and a definition is a
   * tree, so a faithful conversion is impossible in general; this returns a
   * draft plus the list of what it could not convert, and a person decides. An
   * importer that saved directly would produce workflows that look right in a
   * diagram and take a different path in production.
   */
  @Post('workflows/import-bpmn')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @ApiRoute({
    summary: 'Convert a BPMN 2.0 process into a workflow definition',
    description:
      'Returns a draft definition and the warnings that came with it — loops, unmatched gateways, ' +
      'elements with no equivalent. Nothing is registered: review the draft and save it like any other.',
    tags: ['metadata'],
    body: bpmnImportSchema,
  })
  importBpmnDocument(@Body(zodBody(bpmnImportSchema)) body: z.infer<typeof bpmnImportSchema>) {
    try {
      const result = importBpmn(body.xml, body.processId ? { processId: body.processId } : {});
      // Run the draft through the same check registration uses, so the editor
      // opens with the real verdict rather than discovering it on save.
      const checked = checkDefinition(result.definition);
      return {
        ...result,
        valid: checked.valid,
        issues: checked.valid ? [] : checked.issues,
      };
    } catch (failure) {
      throw new BadRequestException({ error: ErrorCode.INVALID_ARGUMENT, message: (failure as Error).message });
    }
  }

  @Post('export')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({
    summary: 'Export workflows and task definitions as one JSON bundle',
    description:
      'Everything reachable when `workflows` is omitted. With `includeDependencies` (the default), the sub-workflows, ' +
      'started workflows and failure workflows a workflow names come along, with the task definitions its worker tasks use. ' +
      'Tag-protected workflows you cannot reach are left out.',
    tags: ['metadata'],
    body: exportSchema,
  })
  exportBundle(@CurrentPrincipal() principal: Principal, @Body(zodBody(exportSchema)) body: z.infer<typeof exportSchema>) {
    return exportDefinitions(this.metadata, principal.namespaceId, accessPolicy(principal), body);
  }

  @Audited('definitions', 'import')
  @Post('import')
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'UPDATE')
  @ApiRoute({
    summary: 'Import a bundle of workflows and task definitions',
    description:
      'The whole bundle is validated before anything is written; if any definition is invalid, nothing is imported and ' +
      'the report says which. An existing workflow version is `unchanged` when identical, otherwise skipped or registered ' +
      'as the next version (`workflowConflicts`); an existing task definition is skipped or overwritten ' +
      '(`taskDefinitionConflicts`). `dryRun` reports without writing. Requests are limited to 1 MB; split larger bundles.',
    tags: ['metadata'],
    body: importSchema,
  })
  importBundle(@CurrentPrincipal() principal: Principal, @Body(zodBody(importSchema)) body: z.infer<typeof importSchema>) {
    return importDefinitions(this.metadata, principal.namespaceId, accessPolicy(principal), body.bundle, {
      workflowConflicts: body.workflowConflicts,
      taskDefinitionConflicts: body.taskDefinitionConflicts,
      dryRun: body.dryRun,
      createdBy: principal.name,
      beforeCreate: () => this.quotas.assertMayCreate(principal.namespaceId, 'maxWorkflowDefinitions'),
    });
  }

  @Get('workflows')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({ summary: 'List registered workflows', tags: ['metadata'] })
  listWorkflows(@CurrentPrincipal() principal: Principal) {
    return this.metadata.listWorkflows(principal.namespaceId, accessPolicy(principal));
  }

  @Get('workflows/:name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @AllowResourceGrant('WORKFLOW', 'READ')
  @ApiRoute({
    summary: 'Fetch one workflow definition',
    tags: ['metadata'],
    query: z.object({ version: z.coerce.number().int().positive().optional() }),
  })
  async getWorkflow(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Query('version') version?: string
  ) {
    const parsedVersion = versionParam.parse(version);
    const definition = await this.metadata.getWorkflowDefinition(
      principal.namespaceId,
      name,
      accessPolicy(principal),
      parsedVersion
    );

    if (!definition) {
      throw new NotFoundException({
        error: 'NOT_FOUND',
        message: `no workflow "${name}"${parsedVersion ? ` version ${parsedVersion}` : ''}`,
      });
    }

    return definition;
  }

  @Audited('workflow', 'tags-set')
  @Put('workflows/:name/tags')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'UPDATE')
  @ApiRoute({
    summary: 'Replace the tags on a workflow',
    description:
      'Applies to every version: tags protect a workflow by name. Tags restrict, never grant — ' +
      'a tagged workflow is reachable only by principals holding a matching tag grant.',
    tags: ['metadata'],
    body: tagsSchema,
  })
  async setWorkflowTags(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Body(zodBody(tagsSchema)) body: z.infer<typeof tagsSchema>
  ) {
    const outcome = await this.metadata.setTags(principal.namespaceId, name, body.tags, accessPolicy(principal));
    if (outcome === 'not_found') {
      throw new NotFoundException({ error: 'NOT_FOUND', message: `no workflow "${name}"` });
    }
    return { name, tags: await this.metadata.tagsOf(principal.namespaceId, name) };
  }

  @Audited('workflow', 'delete')
  @Delete('workflows/:name')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @AllowResourceGrant('WORKFLOW', 'DELETE')
  @ApiRoute({
    summary: 'Delete one version of a workflow definition',
    description:
      'Refused with 409 while any execution of that version is still running: running ' +
      'executions reload their definition, and deleting it would strand them.',
    tags: ['metadata'],
    query: z.object({ version: z.coerce.number().int().positive() }),
  })
  async deleteWorkflow(
    @CurrentPrincipal() principal: Principal,
    @Param('name') name: string,
    @Query('version') version?: string
  ) {
    // Required, not defaulted to latest: "delete the workflow" with no version
    // is ambiguous, and guessing wrong is unrecoverable.
    const parsed = z.coerce.number().int().positive().safeParse(version);
    if (!parsed.success) {
      throw new NodeFlowError(ErrorCode.INVALID_ARGUMENT, 'version is required to delete a workflow definition');
    }

    const outcome = await this.metadata.deleteWorkflowVersion(principal.namespaceId, name, parsed.data, accessPolicy(principal));

    if (outcome === 'not_found') {
      throw new NotFoundException({ error: 'NOT_FOUND', message: `no workflow "${name}" version ${parsed.data}` });
    }
    if (outcome === 'in_use') {
      throw new NodeFlowError(
        ErrorCode.CONFLICT,
        `workflow "${name}" version ${parsed.data} still has running executions; terminate or let them finish first`
      );
    }
    return { name, version: parsed.data, deleted: true };
  }

  @Audited('task-definition', 'put')
  @Post('task-definitions')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @AllowResourceGrant('TASK_DEFINITION', 'UPDATE')
  @ApiRoute({
    summary: 'Create or update a task definition',
    description: 'Unlike workflows, task definitions are mutable.',
    tags: ['metadata'],
    body: taskDefinitionSchema,
  })
  upsertTaskDefinition(@CurrentPrincipal() principal: Principal, @Body() body: unknown) {
    const name = typeof (body as { name?: unknown })?.name === 'string' ? (body as { name: string }).name : '';
    if (!mayUse(principal, 'UPDATE', { name, tags: [], type: 'TASK_DEFINITION' })) throw taskDefinitionNotAllowed(name);
    return this.metadata.upsertTaskDefinition(principal.namespaceId, body);
  }

  @Get('task-definitions')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @AllowResourceGrant('TASK_DEFINITION', 'READ')
  @ApiRoute({ summary: 'List task definitions', tags: ['metadata'] })
  async listTaskDefinitions(@CurrentPrincipal() principal: Principal) {
    return (await this.metadata.listTaskDefinitions(principal.namespaceId)).filter((definition) =>
      mayUse(principal, 'READ', { name: definition.name, tags: [], type: 'TASK_DEFINITION' })
    );
  }

  @Get('task-definitions/:name')
  @RequireScopes(Scope.WORKFLOWS_READ)
  @AllowResourceGrant('TASK_DEFINITION', 'READ')
  @ApiRoute({ summary: 'Get a task definition', tags: ['metadata'] })
  async getTaskDefinition(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const definition = mayUse(principal, 'READ', { name, tags: [], type: 'TASK_DEFINITION' })
      ? await this.metadata.getTaskDefinition(principal.namespaceId, name)
      : undefined;
    if (!definition) throw new NotFoundException({ error: 'NOT_FOUND', message: `no task definition "${name}"` });
    return definition;
  }

  @Audited('task-definition', 'delete')
  @Delete('task-definitions/:name')
  @RequireScopes(Scope.WORKFLOWS_WRITE)
  @AllowResourceGrant('TASK_DEFINITION', 'DELETE')
  @ApiRoute({
    summary: 'Delete a task definition',
    description:
      'Refused with 409 while tasks of this type are queued or running: they would silently ' +
      'lose their retry and timeout policy mid-flight.',
    tags: ['metadata'],
  })
  async deleteTaskDefinition(@CurrentPrincipal() principal: Principal, @Param('name') name: string) {
    const outcome = mayUse(principal, 'DELETE', { name, tags: [], type: 'TASK_DEFINITION' })
      ? await this.metadata.deleteTaskDefinition(principal.namespaceId, name)
      : 'not_found';
    if (outcome === 'not_found') {
      throw new NotFoundException({ error: 'NOT_FOUND', message: `no task definition "${name}"` });
    }
    if (outcome === 'in_use') {
      throw new NodeFlowError(
        ErrorCode.CONFLICT,
        `task definition "${name}" has tasks queued or running; let them finish first`
      );
    }
    return { name, deleted: true };
  }
}

@Module({ controllers: [MetadataController] })
export class MetadataModule {}

/** Refused as not found, so a caller cannot learn which task definitions exist. */
function taskDefinitionNotAllowed(name: string): NotFoundException {
  return new NotFoundException({ error: 'NOT_FOUND', message: `no task definition "${name}" you may change` });
}

/**
 * `tags` travels alongside the definition rather than inside it: it is access
 * control, not workflow shape.
 *
 * Absent means "keep the tags it has", not "no tags" — the editor saves a new
 * version without mentioning tags, and reading that as an instruction to clear
 * them made every save from the UI strip a workflow's protection.
 */
function tagsOf(body: unknown): string[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const tags = (body as { tags?: unknown }).tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : undefined;
}

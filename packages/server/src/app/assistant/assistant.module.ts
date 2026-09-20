import { Body, Controller, HttpCode, Inject, Module, Post } from '@nestjs/common';
import { Scope, type JsonValue, type Principal } from '@node-flow-dev/core';
import { MetadataRepository, SearchRepository, WorkflowRepository, checkDefinition } from '@node-flow-dev/store';
import { askAssistant, type AiExecutorOptions, type AssistantContext } from '@node-flow-dev/tasks';
import { z } from 'zod';
import { CurrentPrincipal, RequireScopes } from '../auth/auth.decorators.js';
import { accessPolicy, mayUse } from '../common/access-policy.js';
import { zodBody } from '../common/zod.pipe.js';
import { AI_EXECUTOR_OPTIONS } from '../database/database.module.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * The assistant endpoint.
 *
 * One job that cannot be done inside `tasks`: deciding what this caller is
 * allowed to see. Every tool the model gets is built here, closed over *this*
 * principal's tag grants and resource permissions, so the assistant can never
 * read a workflow its user could not open themselves.
 *
 * That is enforced by construction rather than by prompt. A system message
 * asking a model not to look at something is a suggestion; a tool that returns
 * only what the caller may read is a boundary.
 *
 * Nothing here acts. The tools list, read, search and validate — no start, no
 * retry, no terminate, no register. A proposed definition comes back for a
 * person to open in the editor and save, which is the same stance the BPMN
 * import takes and for the same reason.
 */

const askSchema = z.object({
  /** The conversation so far. The last turn is the question being asked. */
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(20_000) }))
    .min(1)
    .max(40),
  /** Which configured LLM integration to use. */
  llmProvider: z.string().min(1),
  model: z.string().min(1).optional(),
});

@Controller('ns/:ns/assistant')
export class AssistantController {
  constructor(
    private readonly metadata: MetadataRepository,
    private readonly search: SearchRepository,
    private readonly workflows: WorkflowRepository,
    @Inject(AI_EXECUTOR_OPTIONS) private readonly ai: AiExecutorOptions
  ) {}

  @Post()
  @HttpCode(200)
  @RequireScopes(Scope.WORKFLOWS_READ)
  @ApiRoute({
    summary: 'Ask the assistant about this namespace',
    description:
      'Answers using read-only tools scoped to what the caller may see: list and read workflows, ' +
      'search executions, read one execution, validate a draft. It cannot start, retry, terminate ' +
      'or register anything, and a definition it proposes is returned for review, never saved.',
    tags: ['ai'],
    body: askSchema,
  })
  async ask(@CurrentPrincipal() principal: Principal, @Body(zodBody(askSchema)) body: z.infer<typeof askSchema>) {
    const answer = await askAssistant(this.ai, this.contextFor(principal), {
      namespaceId: principal.namespaceId,
      llmProvider: body.llmProvider,
      ...(body.model ? { model: body.model } : {}),
      messages: body.messages,
    });

    return answer;
  }

  /** The caller's own view of the namespace, as a set of functions. */
  private contextFor(principal: Principal): AssistantContext {
    const access = accessPolicy(principal);
    const mayRead = (name: string, tags: string[]) => mayUse(principal, 'READ', { name, tags });

    return {
      listWorkflows: async () => {
        const rows = await this.metadata.listWorkflows(principal.namespaceId, access);
        const latest = new Map<string, { name: string; description?: string | null; tags: string[] }>();
        for (const row of rows) {
          if (!latest.has(row.name)) latest.set(row.name, { name: row.name, description: row.description, tags: row.tags });
        }
        return [...latest.values()];
      },

      getWorkflow: async (name: string) => {
        const definition = await this.metadata.getWorkflowDefinition(principal.namespaceId, name, access);
        return (definition as JsonValue | undefined) ?? undefined;
      },

      searchExecutions: async (query) => {
        const result = await this.search.executions({
          namespaceId: principal.namespaceId,
          ...(query.status ? { status: [query.status as never] } : {}),
          ...(query.workflow ? { defName: query.workflow } : {}),
          limit: Math.min(Math.max(query.limit ?? 10, 1), 25),
        });

        // Only the fields an explanation needs. A full execution list would
        // spend the model's context on ids and timestamps it will not use.
        return result.executions.map((execution) => ({
          workflowId: execution.id,
          workflow: execution.defName,
          status: execution.status,
          startedAt: execution.startedAt?.toISOString?.() ?? null,
          reasonForIncompletion: execution.reasonForIncompletion ?? null,
        })) as JsonValue;
      },

      getExecution: async (workflowId: string) => {
        const execution = await this.workflows.findById(workflowId);
        if (!execution || execution.namespaceId !== principal.namespaceId) return undefined;

        const tags = (await this.metadata.tagsOf(principal.namespaceId, execution.defName)) ?? [];
        if (!mayRead(execution.defName, tags)) return undefined;

        const { tasks } = await this.workflows.loadAllTasks(workflowId);
        return {
          workflowId: execution.id,
          workflow: execution.defName,
          status: execution.status,
          reasonForIncompletion: execution.reasonForIncompletion ?? null,
          tasks: tasks.map((task) => ({
            refName: task.refName,
            type: task.taskType,
            status: task.status,
            attempt: task.attempt,
            reasonForIncompletion: task.reasonForIncompletion ?? null,
          })),
        } as JsonValue;
      },

      validateDefinition: async (definition: JsonValue) => {
        const checked = checkDefinition(definition);
        return (
          checked.valid
            ? { valid: true, taskCount: checked.blueprint.size }
            : { valid: false, stage: checked.stage, issues: checked.issues }
        ) as JsonValue;
      },
    };
  }
}

@Module({ controllers: [AssistantController] })
export class AssistantModule {}

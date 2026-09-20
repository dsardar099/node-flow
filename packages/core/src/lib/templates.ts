import { TaskType } from './task-type.js';
import type { WorkflowDefinition } from './definitions.js';

/**
 * Starter workflows.
 *
 * A blank editor is the worst first experience this product can give: the DSL
 * is capable, the expression syntax is unfamiliar, and the gap between "I
 * understand what an orchestrator is" and "I have written a correct
 * `${task.output.field}` reference" is where people give up. These close it.
 *
 * Two rules keep them worth shipping:
 *
 *  - **Every template compiles.** They are validated by a test against the same
 *    compiler registration uses, so a template can never be a broken example
 *    that teaches a mistake. A starter that fails on save is worse than none.
 *  - **Each one teaches exactly one thing**, named in `teaches`. A template
 *    that demonstrates six features at once is a thing to admire, not a thing
 *    to learn from, and nobody edits it — they start over.
 *
 * They live in `core` rather than the dashboard because the dashboard is not
 * the only thing that should be able to offer them: the CLI can, and a test can
 * prove they are valid without a browser.
 */

export interface WorkflowTemplate {
  id: string;
  title: string;
  /** One sentence, in the language of the problem rather than the DSL. */
  summary: string;
  /** The single idea this template exists to demonstrate. */
  teaches: string;
  category: 'Integration' | 'Flow control' | 'People' | 'Reliability' | 'AI';
  definition: WorkflowDefinition;
}

/** Fills in the fields every definition needs but no template should have to repeat. */
function workflow(
  name: string,
  tasks: WorkflowDefinition['tasks'],
  extra: Partial<WorkflowDefinition> = {}
): WorkflowDefinition {
  return {
    name,
    version: 1,
    tasks,
    inputParameters: [],
    maxConcurrentTasks: 0,
    tags: [],
    ...extra,
  } as WorkflowDefinition;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'fetch-and-transform',
    title: 'Call an API and reshape the answer',
    summary: 'Fetches a resource over HTTP and turns the response into the shape the next step wants.',
    teaches: 'How a task reads another task’s output with ${ref.output.field}.',
    category: 'Integration',
    definition: workflow('fetch_and_transform', [
      {
        name: 'fetch',
        taskReferenceName: 'fetch',
        type: TaskType.HTTP,
        inputParameters: { uri: 'https://api.example.com/orders/${workflow.input.orderId}', method: 'GET' },
      },
      {
        name: 'reshape',
        taskReferenceName: 'reshape',
        type: TaskType.JSON_JQ_TRANSFORM,
        inputParameters: {
          order: '${fetch.output.body}',
          queryExpression: '{ id: .order.id, total: .order.amount, currency: .order.currency }',
        },
      },
    ], {
      inputParameters: ['orderId'],
      outputParameters: { order: '${reshape.output.result}' },
    }),
  },
  {
    id: 'approval',
    title: 'Ask a person, then act on the answer',
    summary: 'Opens a task in someone’s inbox and takes a different path depending on what they decide.',
    teaches: 'How a HUMAN task pauses a run, and how a SWITCH reads its result.',
    category: 'People',
    definition: workflow('approval', [
      {
        name: 'review',
        taskReferenceName: 'review',
        type: TaskType.HUMAN,
        inputParameters: {
          assignee: '${workflow.input.reviewer}',
          amount: '${workflow.input.amount}',
        },
      },
      {
        name: 'on_decision',
        taskReferenceName: 'on_decision',
        type: TaskType.SWITCH,
        // `value-param` reads one input by name, which is the simplest thing
        // that works and the easiest to change later.
        evaluatorType: 'value-param',
        expression: 'decision',
        inputParameters: { decision: '${review.output.decision}' },
        decisionCases: {
          approved: [
            {
              name: 'pay',
              taskReferenceName: 'pay',
              type: TaskType.SIMPLE,
              inputParameters: { amount: '${workflow.input.amount}' },
            },
          ],
        },
        defaultCase: [
          {
            name: 'notify_rejection',
            taskReferenceName: 'notify_rejection',
            type: TaskType.SIMPLE,
            inputParameters: { reason: '${review.output.comment}' },
          },
        ],
      },
    ], { inputParameters: ['reviewer', 'amount'] }),
  },
  {
    id: 'parallel-enrichment',
    title: 'Do two things at once, then continue',
    summary: 'Runs two independent lookups in parallel and waits for both before combining them.',
    teaches: 'How FORK_JOIN and JOIN work, and that a join names the branch tips.',
    category: 'Flow control',
    definition: workflow('parallel_enrichment', [
      {
        name: 'enrich',
        taskReferenceName: 'enrich',
        type: TaskType.FORK_JOIN,
        forkTasks: [
          [
            {
              name: 'credit_score',
              taskReferenceName: 'credit_score',
              type: TaskType.SIMPLE,
              inputParameters: { customerId: '${workflow.input.customerId}' },
            },
          ],
          [
            {
              name: 'order_history',
              taskReferenceName: 'order_history',
              type: TaskType.SIMPLE,
              inputParameters: { customerId: '${workflow.input.customerId}' },
            },
          ],
        ],
      },
      {
        name: 'wait_for_both',
        taskReferenceName: 'wait_for_both',
        type: TaskType.JOIN,
        joinOn: ['credit_score', 'order_history'],
      },
      {
        name: 'decide',
        taskReferenceName: 'decide',
        type: TaskType.SIMPLE,
        inputParameters: {
          score: '${credit_score.output.score}',
          orders: '${order_history.output.orders}',
        },
      },
    ], { inputParameters: ['customerId'] }),
  },
  {
    id: 'saga',
    title: 'Undo earlier steps when a later one fails',
    summary: 'Books a hotel and a flight; if the flight fails, the hotel booking is cancelled automatically.',
    teaches: 'How compensateWith unwinds completed work in reverse, without writing the unwinding by hand.',
    category: 'Reliability',
    definition: workflow('book_trip', [
      {
        name: 'book_hotel',
        taskReferenceName: 'book_hotel',
        type: TaskType.SIMPLE,
        inputParameters: { city: '${workflow.input.city}' },
        // A task, not a name: it receives this task's input and output, which
        // is what a cancellation needs to know which booking to undo.
        compensateWith: {
          name: 'cancel_hotel',
          taskReferenceName: 'cancel_hotel',
          type: TaskType.SIMPLE,
          inputParameters: { bookingId: '${book_hotel.output.bookingId}' },
        },
      },
      {
        name: 'book_flight',
        taskReferenceName: 'book_flight',
        type: TaskType.SIMPLE,
        retryCount: 2,
        inputParameters: { city: '${workflow.input.city}' },
      },
    ], { inputParameters: ['city'] }),
  },
  {
    id: 'poll-until-ready',
    title: 'Wait for a long job somewhere else',
    summary: 'Starts a job on another system and polls it until it reports success.',
    teaches: 'How HTTP_POLL waits without holding a worker, and how its stop condition is written.',
    category: 'Integration',
    definition: workflow('poll_until_ready', [
      {
        name: 'start_job',
        taskReferenceName: 'start_job',
        type: TaskType.HTTP,
        inputParameters: { uri: 'https://api.example.com/jobs', method: 'POST', body: { input: '${workflow.input.payload}' } },
      },
      {
        name: 'await_job',
        taskReferenceName: 'await_job',
        type: TaskType.HTTP_POLL,
        inputParameters: {
          uri: 'https://api.example.com/jobs/${start_job.output.body.id}',
          method: 'GET',
          terminationCondition: "$.output.body.status === 'done'",
          pollingIntervalSeconds: 10,
          pollingStrategy: 'FIXED',
        },
      },
    ], { inputParameters: ['payload'] }),
  },
  {
    id: 'retry-each-item',
    title: 'Repeat a step for each item',
    summary: 'Loops over a list, handling one item per iteration.',
    teaches: 'How DO_WHILE expresses repetition, and how a body reads the current iteration.',
    category: 'Flow control',
    definition: workflow('process_batch', [
      {
        name: 'each_item',
        taskReferenceName: 'each_item',
        type: TaskType.DO_WHILE,
        // The engine's own condition syntax: the iteration counter comes from
        // the loop task's output, and the list length from the workflow input.
        loopCondition: '${each_item.output.iteration} < ${workflow.input.itemCount}',
        loopOver: [
          {
            name: 'handle_item',
            taskReferenceName: 'handle_item',
            type: TaskType.SIMPLE,
            inputParameters: { index: '${each_item.output.iteration}' },
          },
        ],
      },
    ], { inputParameters: ['itemCount'] }),
  },
  {
    id: 'rag-answer',
    title: 'Answer a question from your own documents',
    summary: 'Searches an index for relevant passages and asks a model to answer using only those.',
    teaches: 'How retrieval and a model call fit together, and how the passages reach the prompt.',
    category: 'AI',
    definition: workflow('rag_answer', [
      {
        name: 'find_passages',
        taskReferenceName: 'find_passages',
        type: TaskType.LLM_SEARCH_INDEX,
        inputParameters: {
          llmProvider: '${workflow.input.llmProvider}',
          index: '${workflow.input.index}',
          query: '${workflow.input.question}',
          topK: 5,
        },
      },
      {
        name: 'answer',
        taskReferenceName: 'answer',
        type: TaskType.LLM_TEXT_COMPLETE,
        inputParameters: {
          llmProvider: '${workflow.input.llmProvider}',
          instructions: 'Answer using only the passages provided. If they do not contain the answer, say so.',
          prompt: 'Question: ${workflow.input.question}\n\nPassages: ${find_passages.output.results}',
        },
      },
    ], {
      inputParameters: ['question', 'index', 'llmProvider'],
      outputParameters: { answer: '${answer.output.result}' },
    }),
  },
];

/** One template by id, for a "new from template" link that can be shared. */
export function templateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((template) => template.id === id);
}

import type { TaskType, WorkflowTask } from '@node-flow-dev/core';

/**
 * Every task type the editor can insert, and what a fresh one looks like.
 *
 * Typed as `Record<TaskType, …>` on purpose. Adding a task type to `core`
 * without describing it here is a **compile error**, not a palette that quietly
 * lacks the new entry — which is how an editor falls behind its own engine.
 *
 * The import from `core` is type-only, so none of it reaches the browser: the
 * DSL is defined once, and the editor pays nothing at runtime for sharing it.
 */

export type Category = 'Workers' | 'Flow control' | 'Data' | 'Integrations' | 'AI' | 'People and time';

export interface CatalogEntry {
  label: string;
  category: Category;
  summary: string;
  /** Operators that own nested task lists, which the graph draws as branches. */
  shape?: 'switch' | 'fork' | 'loop';
  /** Only valid as the partner of another type; never offered on its own. */
  companion?: true;
}

export const CATALOG: Record<TaskType, CatalogEntry> = {
  SIMPLE: { label: 'Worker task', category: 'Workers', summary: 'Runs on your own worker fleet' },

  SWITCH: {
    label: 'Switch',
    category: 'Flow control',
    summary: 'Takes one branch based on a value',
    shape: 'switch',
  },
  FORK_JOIN: {
    label: 'Parallel branches',
    category: 'Flow control',
    summary: 'Runs branches at the same time, then joins',
    shape: 'fork',
  },
  DO_WHILE: {
    label: 'Loop',
    category: 'Flow control',
    summary: 'Repeats a body while a condition holds',
    shape: 'loop',
  },
  FORK_JOIN_DYNAMIC: {
    label: 'Dynamic parallel',
    category: 'Flow control',
    summary: 'Fans out over a list known only at runtime',
  },
  JOIN: {
    label: 'Join',
    category: 'Flow control',
    summary: 'Waits for parallel branches',
    companion: true,
  },
  EXCLUSIVE_JOIN: {
    label: 'Exclusive join',
    category: 'Flow control',
    summary: 'Continues with the first branch to finish',
    companion: true,
  },
  DYNAMIC: {
    label: 'Dynamic task',
    category: 'Flow control',
    summary: 'Chooses which task to run at runtime',
  },
  SUB_WORKFLOW: {
    label: 'Sub-workflow',
    category: 'Flow control',
    summary: 'Runs another workflow and waits for it',
  },
  START_WORKFLOW: {
    label: 'Start workflow',
    category: 'Flow control',
    summary: 'Starts another workflow without waiting',
  },
  TERMINATE: { label: 'Terminate', category: 'Flow control', summary: 'Ends the workflow here' },
  YIELD: { label: 'Yield', category: 'Flow control', summary: 'Pauses until signalled' },
  NOOP: { label: 'No-op', category: 'Flow control', summary: 'Does nothing; a placeholder' },

  SET_VARIABLE: { label: 'Set variable', category: 'Data', summary: 'Writes workflow variables' },
  GET_WORKFLOW: { label: 'Get workflow', category: 'Data', summary: 'Reads another execution' },
  INLINE: { label: 'Inline script', category: 'Data', summary: 'Sandboxed JavaScript' },
  JSON_JQ_TRANSFORM: { label: 'JQ transform', category: 'Data', summary: 'Reshapes JSON with jq' },
  BUSINESS_RULE: { label: 'Business rule', category: 'Data', summary: 'Evaluates a rule table' },
  UPDATE_SECRET: { label: 'Update secret', category: 'Data', summary: 'Writes a managed secret' },
  GET_SIGNED_JWT: { label: 'Signed JWT', category: 'Data', summary: 'Mints a signed token' },
  EMAIL: { label: 'Send email', category: 'Integrations', summary: 'Sends a message through a configured SMTP transport' },
  UPDATE_TASK: { label: 'Update task', category: 'Data', summary: 'Completes another task' },

  HTTP: { label: 'HTTP request', category: 'Integrations', summary: 'Calls an HTTP API, by URL or by registered service name' },
  HTTP_POLL: { label: 'HTTP poll', category: 'Integrations', summary: 'Polls until a condition' },
  WEBHOOK: { label: 'Send webhook', category: 'Integrations', summary: 'Delivers a signed event' },
  EVENT: { label: 'Publish event', category: 'Integrations', summary: 'Publishes to a broker sink, such as nats:default:orders.created' },
  KAFKA_PUBLISH: { label: 'Kafka publish', category: 'Integrations', summary: 'Writes to a topic' },
  JDBC: { label: 'SQL query', category: 'Integrations', summary: 'Runs a SQL statement' },
  GRPC: { label: 'gRPC call', category: 'Integrations', summary: 'Calls a gRPC method' },

  LLM_TEXT_COMPLETE: { label: 'LLM text completion', category: 'AI', summary: 'Sends a prompt to a model' },
  LLM_CHAT_COMPLETE: { label: 'LLM chat', category: 'AI', summary: 'Continues a conversation with a model' },
  AGENT: { label: 'Agent', category: 'AI', summary: 'A model that calls tools until it has an answer' },
  LLM_GENERATE_EMBEDDINGS: { label: 'Generate embeddings', category: 'AI', summary: 'Turns text into vectors' },
  LLM_INDEX_TEXT: { label: 'Index text', category: 'AI', summary: 'Chunks, embeds and stores a document' },
  LLM_SEARCH_INDEX: { label: 'Search index', category: 'AI', summary: 'Finds the passages closest to a query' },
  CHUNK_TEXT: { label: 'Chunk text', category: 'AI', summary: 'Splits text into overlapping pieces' },
  LIST_MCP_TOOLS: { label: 'List MCP tools', category: 'AI', summary: 'Lists the tools an MCP server offers' },
  CALL_MCP_TOOL: { label: 'Call MCP tool', category: 'AI', summary: 'Calls a tool on an MCP server' },
  PARSE_DOCUMENT: { label: 'Parse document', category: 'AI', summary: 'Extracts text from a PDF, web page or file' },
  GENERATE_IMAGE: { label: 'Generate image', category: 'AI', summary: 'Creates images from a prompt' },
  GENERATE_AUDIO: { label: 'Generate speech', category: 'AI', summary: 'Turns text into spoken audio' },
  GENERATE_VIDEO: { label: 'Generate video', category: 'AI', summary: 'Creates a video from a prompt, polling until it is ready' },

  HUMAN: { label: 'Human task', category: 'People and time', summary: 'Waits for a person' },
  WAIT: { label: 'Wait', category: 'People and time', summary: 'Pauses for a duration' },
  WAIT_FOR_WEBHOOK: {
    label: 'Wait for webhook',
    category: 'People and time',
    summary: 'Pauses until a callback arrives',
  },
  PULL_WORKFLOW_MESSAGES: {
    label: 'Pull messages',
    category: 'People and time',
    summary: 'Waits for messages pushed into the run',
  },
};

/** Lower-case, underscore-joined, and unique within the workflow. */
export function uniqueRef(base: string, taken: ReadonlySet<string>): string {
  const stem =
    base
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'task';

  if (!taken.has(stem)) return stem;

  for (let n = 2; ; n++) {
    const candidate = `${stem}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The tasks a single "insert" produces.
 *
 * Usually one. A parallel block is two — the fork **and** its join — because
 * the compiler requires a `FORK_JOIN` to be followed immediately by a join, and
 * an editor that inserted a bare fork would hand the user a definition that is
 * invalid by construction, with an error naming a rule they never chose.
 *
 * Templates aim to be as close to valid as a blank can be, and no closer: a
 * switch gets a placeholder expression and one case, a loop a body task and a
 * condition. What cannot be guessed — a URL, a sub-workflow's name — is left
 * for validation to point at, rather than filled with something plausible that
 * would pass validation and fail at runtime.
 */
export function blankTasks(type: TaskType, taken: ReadonlySet<string>): WorkflowTask[] {
  const used = new Set(taken);
  const ref = (base: string) => {
    const chosen = uniqueRef(base, used);
    used.add(chosen);
    return chosen;
  };

  const own = ref(type);
  const base: WorkflowTask = { name: own, taskReferenceName: own, type };

  switch (type) {
    case 'SWITCH': {
      const first = ref('case_a');
      return [
        {
          ...base,
          evaluatorType: 'value-param',
          expression: 'value',
          inputParameters: { value: '${workflow.input.choice}' },
          decisionCases: { a: [{ name: first, taskReferenceName: first, type: 'NOOP' }] },
          defaultCase: [],
        },
      ];
    }

    case 'FORK_JOIN': {
      const left = ref('branch_a');
      const right = ref('branch_b');
      const join = ref(`${own}_join`);
      return [
        {
          ...base,
          forkTasks: [
            [{ name: left, taskReferenceName: left, type: 'NOOP' }],
            [{ name: right, taskReferenceName: right, type: 'NOOP' }],
          ],
        },
        { name: join, taskReferenceName: join, type: 'JOIN', joinOn: [left, right] },
      ];
    }

    case 'DO_WHILE': {
      const body = ref('loop_body');
      return [
        {
          ...base,
          // The engine's condition syntax, not Conductor's JavaScript one:
          // `$.loop['iteration'] < 3` is compared as literal text and the loop
          // silently runs once. This template shipped with that mistake until
          // it was checked against the evaluator.
          loopCondition: '${' + own + '.output.iteration} < 3',
          loopOver: [{ name: body, taskReferenceName: body, type: 'NOOP' }],
        },
      ];
    }

    // No placeholder name for SUB_WORKFLOW or START_WORKFLOW. A plausible one
    // would pass validation and fail at runtime; absent, the compiler names
    // the task and says what to set.

    // An empty value, not an absent key and not a guess: the key shows where
    // to fill in, and the compiler still refuses the task until someone does.
    case 'HTTP':
      return [{ ...base, inputParameters: { uri: '', method: 'GET' } }];
    case 'EVENT':
      return [{ ...base, inputParameters: { sink: '' } }];
    case 'KAFKA_PUBLISH':
      return [{ ...base, inputParameters: { topic: '' } }];
    case 'PULL_WORKFLOW_MESSAGES':
      return [{ ...base, inputParameters: { batchSize: 1 } }];
    case 'LLM_TEXT_COMPLETE':
      return [{ ...base, inputParameters: { llmProvider: '', model: '', prompt: '' } }];
    case 'LLM_CHAT_COMPLETE':
      return [{ ...base, inputParameters: { llmProvider: '', model: '', instructions: '', messages: [{ role: 'user', message: '' }] } }];
    case 'AGENT':
      return [{ ...base, inputParameters: { llmProvider: '', model: '', instructions: '', prompt: '', tools: [], maxSteps: 10 } }];
    case 'LLM_GENERATE_EMBEDDINGS':
      return [{ ...base, inputParameters: { llmProvider: '', embeddingModel: '', text: '' } }];
    case 'LLM_INDEX_TEXT':
      return [{ ...base, inputParameters: { llmProvider: '', embeddingModel: '', index: '', docId: '', text: '' } }];
    case 'LLM_SEARCH_INDEX':
      return [{ ...base, inputParameters: { llmProvider: '', embeddingModel: '', index: '', query: '', topK: 5 } }];
    case 'CHUNK_TEXT':
      return [{ ...base, inputParameters: { text: '', chunkSize: 1000, chunkOverlap: 100 } }];
    case 'LIST_MCP_TOOLS':
      return [{ ...base, inputParameters: { mcpServer: '' } }];
    case 'CALL_MCP_TOOL':
      return [{ ...base, inputParameters: { mcpServer: '', method: '', arguments: {} } }];
    case 'PARSE_DOCUMENT':
      return [{ ...base, inputParameters: { url: '' } }];
    case 'GENERATE_IMAGE':
      return [{ ...base, inputParameters: { llmProvider: '', model: '', prompt: '', size: '1024x1024' } }];
    case 'GENERATE_AUDIO':
      return [{ ...base, inputParameters: { llmProvider: '', model: '', text: '', voice: 'alloy' } }];
    case 'EMAIL':
      return [{ ...base, inputParameters: { to: '', subject: '', body: '' } }];
    case 'GENERATE_VIDEO':
      return [{ ...base, inputParameters: { llmProvider: '', model: '', prompt: '', aspectRatio: '16:9' } }];

    default:
      return [base];
  }
}

import { XMLParser } from 'fast-xml-parser';

/**
 * Importing BPMN 2.0 into a node-flow definition.
 *
 * ## The hard part, stated plainly
 *
 * BPMN is a **graph**: elements connected by sequence flows, free to branch,
 * merge and loop anywhere. A node-flow definition is a **tree**: an ordered
 * list of tasks where a branch is a nested block owned by the operator that
 * opened it. Every graph is not a tree, so a faithful importer is impossible
 * and the interesting question is what to do about the difference.
 *
 * This importer converts the *structured* subset — where every split has a
 * matching merge and branches nest rather than interleave — and **reports
 * everything it could not convert** instead of guessing. A silently
 * approximated process is worse than a refused one: it produces a workflow
 * that looks right in a diagram and takes a different path in production, and
 * nobody re-reads the original to find out why.
 *
 * So the result always carries `warnings`, the UI shows them before anything is
 * saved, and the import is a **starting point a human edits**, never a
 * migration that runs unattended. That framing is deliberate: it is also what
 * every honest BPMN-to-anything converter does, and the ones that claim
 * otherwise are the ones that hurt.
 *
 * ## What maps to what
 *
 * | BPMN | node-flow |
 * |---|---|
 * | `serviceTask`, `task`, `sendTask`, `receiveTask` | `SIMPLE` |
 * | `userTask`, `manualTask` | `HUMAN` |
 * | `scriptTask` | `INLINE` (the script is carried over as a comment, never executed as-is) |
 * | `callActivity` | `SUB_WORKFLOW` |
 * | `businessRuleTask` | `BUSINESS_RULE` |
 * | `exclusiveGateway` (split) | `SWITCH`, one case per outgoing flow |
 * | `parallelGateway` (split) | `FORK_JOIN` + `JOIN` |
 * | `intermediateCatchEvent` with a timer | `WAIT` |
 * | `endEvent` with a terminate definition | `TERMINATE` |
 * | `startEvent`, plain `endEvent`, converging gateways | nothing; they are structure, not work |
 */

export interface BpmnImportResult {
  /** A node-flow workflow definition, ready to review and register. */
  definition: Record<string, unknown>;
  /** What could not be converted faithfully. Never empty without reason. */
  warnings: string[];
  /** The BPMN process this came from. */
  source: { processId: string; processName?: string };
}

interface BpmnElement {
  id: string;
  name?: string;
  kind: string;
  outgoing: string[];
  incoming: string[];
  /** Raw attributes, for the details a mapping needs. */
  attributes: Record<string, string>;
  /** Child element names present, e.g. `timerEventDefinition`. */
  markers: string[];
  /** A script task's body, a script's language. */
  script?: string;
}

interface BpmnFlow {
  id: string;
  from: string;
  to: string;
  name?: string;
  condition?: string;
}

const TASK_KINDS: Record<string, string> = {
  task: 'SIMPLE',
  serviceTask: 'SIMPLE',
  sendTask: 'SIMPLE',
  receiveTask: 'SIMPLE',
  userTask: 'HUMAN',
  manualTask: 'HUMAN',
  scriptTask: 'INLINE',
  businessRuleTask: 'BUSINESS_RULE',
  callActivity: 'SUB_WORKFLOW',
};

/** Converts a BPMN 2.0 document. Throws only when the document is not BPMN at all. */
export function importBpmn(xml: string, options: { processId?: string } = {}): BpmnImportResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // Namespace prefixes vary by tool — `bpmn:`, `bpmn2:`, `semantic:`, none —
    // and a converter that matches on one of them works for exactly one
    // modeller. Stripping them is what makes this read a Camunda file and a
    // Signavio file the same way.
    removeNSPrefix: true,
    parseAttributeValue: false,
    trimValues: true,
  });

  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`could not parse the file as XML: ${(error as Error).message}`);
  }

  const root = document['definitions'];
  if (root === undefined) throw new Error('this is not a BPMN 2.0 document: no <definitions> element');
  // An empty `<definitions/>` parses to `''` rather than an object. It is still
  // a BPMN document, so the complaint should be about the missing process, not
  // about the file being something else entirely.
  const definitions = asRecord(root) ?? {};

  const processes = asArray(definitions['process']).map(asRecord).filter(isPresent);
  if (processes.length === 0) throw new Error('the document contains no <process>');

  const process =
    (options.processId ? processes.find((p) => attribute(p, 'id') === options.processId) : undefined) ?? processes[0];
  const processId = attribute(process, 'id') ?? 'process';

  const warnings: string[] = [];
  if (processes.length > 1 && !options.processId) {
    warnings.push(
      `the document has ${processes.length} processes; imported "${processId}". Name one explicitly to import a different one.`
    );
  }

  const { elements, flows } = readProcess(process, warnings);
  const converter = new Converter(elements, flows, warnings);
  const tasks = converter.run();

  return {
    definition: {
      name: sanitiseName(attribute(process, 'name') ?? processId),
      version: 1,
      description: attribute(process, 'name') ?? undefined,
      tasks,
    },
    warnings,
    source: { processId, ...(attribute(process, 'name') ? { processName: attribute(process, 'name') as string } : {}) },
  };
}

/** Flattens the process into elements and flows, ignoring diagram information. */
function readProcess(
  process: Record<string, unknown>,
  warnings: string[]
): { elements: Map<string, BpmnElement>; flows: BpmnFlow[] } {
  const elements = new Map<string, BpmnElement>();
  const flows: BpmnFlow[] = [];

  for (const [kind, raw] of Object.entries(process)) {
    if (kind.startsWith('@') || kind === '#text') continue;

    for (const entry of asArray(raw)) {
      const node = asRecord(entry);
      if (!node) continue;
      const id = attribute(node, 'id');
      if (!id) continue;

      if (kind === 'sequenceFlow') {
        const from = attribute(node, 'sourceRef');
        const to = attribute(node, 'targetRef');
        if (!from || !to) continue;
        flows.push({
          id,
          from,
          to,
          ...(attribute(node, 'name') ? { name: attribute(node, 'name') as string } : {}),
          ...(textOf(node['conditionExpression']) ? { condition: textOf(node['conditionExpression']) as string } : {}),
        });
        continue;
      }

      if (kind === 'subProcess') {
        // Nested processes are a real feature and a real amount of work; saying
        // so beats importing the sub-process's contents as if they were the
        // parent's, which changes the order everything runs in.
        warnings.push(`sub-process "${attribute(node, 'name') ?? id}" was not imported; import it as its own workflow and call it with SUB_WORKFLOW`);
      }

      elements.set(id, {
        id,
        ...(attribute(node, 'name') ? { name: attribute(node, 'name') as string } : {}),
        kind,
        outgoing: [],
        incoming: [],
        attributes: attributesOf(node),
        markers: Object.keys(node).filter((key) => !key.startsWith('@') && key !== '#text'),
        ...(textOf(node['script']) ? { script: textOf(node['script']) as string } : {}),
      });
    }
  }

  for (const flow of flows) {
    elements.get(flow.from)?.outgoing.push(flow.id);
    elements.get(flow.to)?.incoming.push(flow.id);
  }

  return { elements, flows };
}

/**
 * Walks the graph from the start event and emits a nested task list.
 *
 * Structured by assumption and honest when the assumption breaks: an element
 * reached twice, a gateway with no matching merge, or a flow that re-enters a
 * branch produces a warning naming the element rather than a quietly wrong
 * shape.
 */
class Converter {
  private readonly visited = new Set<string>();
  private readonly names = new Set<string>();

  constructor(
    private readonly elements: Map<string, BpmnElement>,
    private readonly flows: BpmnFlow[],
    private readonly warnings: string[]
  ) {}

  run(): Record<string, unknown>[] {
    const starts = [...this.elements.values()].filter((element) => element.kind === 'startEvent');
    if (starts.length === 0) {
      this.warnings.push('the process has no start event; nothing could be imported');
      return [];
    }
    if (starts.length > 1) {
      this.warnings.push(`the process has ${starts.length} start events; imported the one named "${starts[0].name ?? starts[0].id}"`);
    }

    const tasks = this.walk(this.next(starts[0]), undefined);

    // Anything the walk never reached is unreachable from the start event, or
    // sits on a path this converter could not follow. Either way it is missing
    // from the result, and that must be said.
    for (const element of this.elements.values()) {
      if (this.visited.has(element.id)) continue;
      if (element.kind === 'startEvent' || element.kind === 'endEvent') continue;
      if (element.kind.endsWith('Gateway')) continue;
      this.warnings.push(`"${element.name ?? element.id}" (${element.kind}) was not reachable from the start event and was left out`);
    }

    return tasks;
  }

  /** Follows the chain from `id` until `stopAt` (exclusive) or the end. */
  private walk(id: string | undefined, stopAt: string | undefined): Record<string, unknown>[] {
    const tasks: Record<string, unknown>[] = [];
    let current = id;

    while (current && current !== stopAt) {
      const element = this.elements.get(current);
      if (!element) return tasks;

      if (this.visited.has(current)) {
        // A cycle. BPMN loops back freely; node-flow expresses repetition with
        // DO_WHILE, whose body is a block — reconstructing one from an
        // arbitrary back-edge is guesswork, so the edge is reported instead.
        this.warnings.push(`the flow loops back to "${element.name ?? element.id}"; rebuild that as a DO_WHILE by hand`);
        return tasks;
      }
      this.visited.add(current);

      if (element.kind === 'exclusiveGateway' || element.kind === 'inclusiveGateway') {
        if (element.outgoing.length <= 1) {
          current = this.next(element);
          continue;
        }
        if (element.kind === 'inclusiveGateway') {
          this.warnings.push(
            `"${element.name ?? element.id}" is an inclusive gateway, which may take several branches at once; imported as a SWITCH, which takes exactly one`
          );
        }
        const { task, after } = this.switchFrom(element);
        tasks.push(task);
        current = after;
        continue;
      }

      if (element.kind === 'parallelGateway' && element.outgoing.length > 1) {
        const { fork, join, after } = this.forkFrom(element);
        tasks.push(fork, join);
        current = after;
        continue;
      }

      const task = this.taskFor(element);
      if (task) tasks.push(task);
      current = this.next(element);
    }

    return tasks;
  }

  /** A SWITCH whose cases are the gateway's outgoing flows. */
  private switchFrom(gateway: BpmnElement): { task: Record<string, unknown>; after: string | undefined } {
    const outgoing = gateway.outgoing.map((id) => this.flows.find((flow) => flow.id === id)).filter(isPresent);
    const merge = this.mergeFor(gateway, outgoing.map((flow) => flow.to));

    const decisionCases: Record<string, Record<string, unknown>[]> = {};
    let defaultCase: Record<string, unknown>[] = [];
    const defaultFlow = gateway.attributes['default'];

    for (const flow of outgoing) {
      const branch = this.walk(flow.to, merge);
      if (flow.id === defaultFlow || (!flow.condition && !flow.name)) {
        defaultCase = branch;
        continue;
      }
      const label = sanitiseName(flow.name ?? flow.condition ?? flow.id);
      decisionCases[label] = branch;
      if (flow.condition) {
        this.warnings.push(
          `case "${label}" came from the BPMN condition \`${flow.condition}\`; node-flow evaluates its own expressions, so check the switch's caseValueParam`
        );
      }
    }

    const ref = this.ref(gateway.name ?? 'decision');
    return {
      task: {
        name: ref,
        taskReferenceName: ref,
        type: 'SWITCH',
        // Left for a human: BPMN puts the decision in each flow's condition,
        // node-flow puts it in one expression on the switch. Inventing one
        // would produce a workflow that always takes the default.
        inputParameters: { switchCaseValue: '' },
        evaluatorType: 'value-param',
        caseValueParam: 'switchCaseValue',
        decisionCases,
        defaultCase,
      },
      after: merge ? this.next(this.elements.get(merge)) : undefined,
    };
  }

  /** A FORK_JOIN over the gateway's branches, and the JOIN that closes it. */
  private forkFrom(gateway: BpmnElement): {
    fork: Record<string, unknown>;
    join: Record<string, unknown>;
    after: string | undefined;
  } {
    const outgoing = gateway.outgoing.map((id) => this.flows.find((flow) => flow.id === id)).filter(isPresent);
    const merge = this.mergeFor(gateway, outgoing.map((flow) => flow.to));

    const branches = outgoing.map((flow) => this.walk(flow.to, merge));
    const tips = branches.map((branch) => branch.at(-1)?.['taskReferenceName']).filter(isPresent) as string[];

    const forkRef = this.ref(gateway.name ?? 'parallel');
    const joinRef = this.ref(`${gateway.name ?? 'parallel'}_join`);

    if (!merge) {
      this.warnings.push(
        `the parallel gateway "${gateway.name ?? gateway.id}" has no matching join; the branches were imported but check where they rejoin`
      );
    }

    return {
      fork: { name: forkRef, taskReferenceName: forkRef, type: 'FORK_JOIN', forkTasks: branches },
      join: { name: joinRef, taskReferenceName: joinRef, type: 'JOIN', joinOn: tips },
      after: merge ? this.next(this.elements.get(merge)) : undefined,
    };
  }

  /**
   * The converging gateway that closes a split, if there is one.
   *
   * Found by walking each branch forward and taking the first element they all
   * reach. That is the definition of a structured merge, and looking for it —
   * rather than assuming the next gateway of the same type — is what stops two
   * unrelated splits from being paired.
   */
  private mergeFor(gateway: BpmnElement, branchHeads: string[]): string | undefined {
    if (branchHeads.length === 0) return undefined;

    const reachable = branchHeads.map((head) => this.reachableFrom(head));
    const shared = reachable.reduce<Set<string>>(
      (all, one) => new Set([...all].filter((id) => one.has(id))),
      new Set(reachable[0])
    );

    // The nearest shared element along the first branch, which is the one the
    // branches actually converge on rather than something further downstream.
    for (const id of this.orderedFrom(branchHeads[0])) {
      if (!shared.has(id)) continue;
      const element = this.elements.get(id);
      if (element && element.incoming.length > 1) return id;
    }

    if (gateway.outgoing.length > 1) {
      this.warnings.push(`"${gateway.name ?? gateway.id}" splits but never merges; its branches were imported to the end of the process`);
    }
    return undefined;
  }

  private reachableFrom(start: string): Set<string> {
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const element = this.elements.get(id);
      for (const flowId of element?.outgoing ?? []) {
        const flow = this.flows.find((f) => f.id === flowId);
        if (flow) queue.push(flow.to);
      }
    }
    return seen;
  }

  /** Breadth-first order from `start`, so "nearest" means nearest. */
  private orderedFrom(start: string): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const flowId of this.elements.get(id)?.outgoing ?? []) {
        const flow = this.flows.find((f) => f.id === flowId);
        if (flow) queue.push(flow.to);
      }
    }
    return order;
  }

  private taskFor(element: BpmnElement): Record<string, unknown> | undefined {
    if (element.kind === 'startEvent') return undefined;

    if (element.kind === 'endEvent') {
      // Only a *terminate* end event ends the whole process; a plain one just
      // ends its path, which a definition expresses by having nothing after it.
      if (!element.markers.includes('terminateEventDefinition')) return undefined;
      const ref = this.ref(element.name ?? 'terminate');
      return {
        name: ref,
        taskReferenceName: ref,
        type: 'TERMINATE',
        inputParameters: { terminationStatus: 'COMPLETED' },
      };
    }

    if (element.kind === 'intermediateCatchEvent' || element.kind === 'intermediateThrowEvent') {
      if (element.markers.includes('timerEventDefinition')) {
        const ref = this.ref(element.name ?? 'wait');
        return { name: ref, taskReferenceName: ref, type: 'WAIT', inputParameters: { duration: '60s' } };
      }
      this.warnings.push(
        `"${element.name ?? element.id}" is a ${element.kind} this importer does not map; it became a NOOP placeholder`
      );
      const ref = this.ref(element.name ?? 'event');
      return { name: ref, taskReferenceName: ref, type: 'NOOP' };
    }

    const type = TASK_KINDS[element.kind];
    if (!type) {
      this.warnings.push(`"${element.name ?? element.id}" is a ${element.kind}, which has no node-flow equivalent; it became a NOOP placeholder`);
      const ref = this.ref(element.name ?? element.kind);
      return { name: ref, taskReferenceName: ref, type: 'NOOP' };
    }

    const ref = this.ref(element.name ?? element.kind);
    const task: Record<string, unknown> = { name: ref, taskReferenceName: ref, type };

    if (type === 'INLINE') {
      // Carried as data, never as something to run: BPMN scripts are usually
      // Groovy or JUEL, and handing one to a JavaScript sandbox would fail at
      // runtime with an error about syntax rather than about the import.
      task['inputParameters'] = {
        evaluatorType: 'javascript',
        expression: 'return {}',
        bpmnScript: element.script ?? '',
      };
      this.warnings.push(`"${element.name ?? element.id}" is a script task; its script was copied into "bpmnScript" for reference and must be rewritten in JavaScript`);
    }

    if (type === 'SUB_WORKFLOW') {
      const called = element.attributes['calledElement'];
      task['subWorkflowParam'] = { name: called ? sanitiseName(called) : '' };
      if (!called) this.warnings.push(`"${element.name ?? element.id}" is a call activity with no calledElement; set the sub-workflow name`);
    }

    if (type === 'HUMAN') {
      task['inputParameters'] = { assignee: element.attributes['assignee'] ?? '' };
    }

    return task;
  }

  /** The single element a flow leads to, or undefined at the end of a path. */
  private next(element: BpmnElement | undefined): string | undefined {
    if (!element || element.outgoing.length === 0) return undefined;
    const flow = this.flows.find((candidate) => candidate.id === element.outgoing[0]);
    return flow?.to;
  }

  /** A reference name that is valid, readable and unique within the workflow. */
  private ref(base: string): string {
    const stem = sanitiseName(base) || 'task';
    if (!this.names.has(stem)) {
      this.names.add(stem);
      return stem;
    }
    for (let n = 2; ; n++) {
      const candidate = `${stem}_${n}`;
      if (!this.names.has(candidate)) {
        this.names.add(candidate);
        return candidate;
      }
    }
  }
}

/** BPMN names are prose — "Check stock levels" — and references are identifiers. */
export function sanitiseName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);
}

function attributesOf(node: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key.startsWith('@'))
      .map(([key, value]) => [key.slice(1), String(value)])
  );
}

function attribute(node: Record<string, unknown>, name: string): string | undefined {
  const value = node[`@${name}`];
  return value === undefined || value === null ? undefined : String(value);
}

/** The text of an element that may be a bare string, or an object with `#text`. */
function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  const record = asRecord(value);
  if (!record) return undefined;
  const text = record['#text'];
  return typeof text === 'string' ? text.trim() || undefined : undefined;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isPresent<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

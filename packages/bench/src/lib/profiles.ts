/**
 * The workflow shapes the harness measures.
 *
 * Two, because they stress different halves of the engine and a single number
 * covering both would describe neither:
 *
 *  - **`chain`** is *K* tasks one after another. Every step is a full engine
 *    round trip — complete, evaluate, schedule, enqueue, lease — so it measures
 *    turnaround latency, which is what a user feels.
 *  - **`fanout`** forks *K* branches and joins them. One evaluation schedules
 *    *K* tasks and the join re-evaluates on every completion, so it measures
 *    what the decider costs under width rather than depth.
 *
 * Both use `SIMPLE` tasks: a benchmark of `INLINE` would mostly measure
 * QuickJS, and a benchmark of `HTTP` would mostly measure whatever it called.
 * The numbers here are meant to be about node-flow.
 */

export type ProfileName = 'chain' | 'fanout';

export interface BenchmarkProfile {
  name: ProfileName;
  /** The definition to register. */
  definition: Record<string, unknown>;
  /** The queue names workers must lease from. */
  queues: string[];
  /** How many worker tasks one run produces. */
  tasksPerRun: number;
  /** The `step` value carried by the task that finishes a run. */
  lastStep: number;
}

export function profileFor(name: ProfileName, options: { steps: number; workflowName: string; queue: string }): BenchmarkProfile {
  return name === 'chain' ? chain(options) : fanout(options);
}

function chain({ steps, workflowName, queue }: { steps: number; workflowName: string; queue: string }): BenchmarkProfile {
  const tasks = Array.from({ length: steps }, (_, index) => ({
    name: queue,
    taskReferenceName: `step_${index}`,
    type: 'SIMPLE',
    // `step` is what tells a worker which task it holds without asking the
    // server, and what lets the harness recognise the end of a run from the
    // completion it is already handling.
    inputParameters: { step: index, run: '${workflow.input.run}' },
  }));

  return {
    name: 'chain',
    definition: { name: workflowName, version: 1, tasks, ownerEmail: 'bench@node-flow.test' },
    queues: [queue],
    tasksPerRun: steps,
    lastStep: steps - 1,
  };
}

function fanout({ steps, workflowName, queue }: { steps: number; workflowName: string; queue: string }): BenchmarkProfile {
  const branches = Array.from({ length: steps }, (_, index) => [
    {
      name: queue,
      taskReferenceName: `branch_${index}`,
      type: 'SIMPLE',
      inputParameters: { step: index, run: '${workflow.input.run}' },
    },
  ]);

  const definition = {
    name: workflowName,
    version: 1,
    ownerEmail: 'bench@node-flow.test',
    tasks: [
      { name: 'fork', taskReferenceName: 'fork', type: 'FORK_JOIN', forkTasks: branches },
      {
        name: 'join',
        taskReferenceName: 'join',
        type: 'JOIN',
        joinOn: branches.map((branch) => branch[0].taskReferenceName),
      },
      // A single tail task, so "the run is done" is one completion rather than
      // a count the harness would have to reconstruct from K branch finishes.
      {
        name: queue,
        taskReferenceName: 'tail',
        type: 'SIMPLE',
        inputParameters: { step: steps, run: '${workflow.input.run}' },
      },
    ],
  };

  return { name: 'fanout', definition, queues: [queue], tasksPerRun: steps + 1, lastStep: steps };
}

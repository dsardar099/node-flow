import type { FaqItem } from '../components/json-ld';

/**
 * Copy the landing page renders *and* the structured data describes.
 *
 * Kept outside `landing.tsx` because that file is a client component and the
 * JSON-LD is emitted by the server page; one array imported by both means the
 * FAQ a crawler reads is always the one a visitor sees.
 */

export const comparisons = [
  { name: 'Netflix Conductor', href: '/docs/alternatives/conductor', text: 'Same JSON model and a compatible API — without Redis or Elasticsearch.' },
  { name: 'Orkes Conductor', href: '/docs/alternatives/orkes', text: 'RBAC, SSO and AI tasks, self-hosted and free to run commercially.' },
  { name: 'Temporal', href: '/docs/alternatives/temporal', text: 'Workflows as readable data, workers without determinism rules.' },
  { name: 'Trigger.dev', href: '/docs/alternatives/trigger-dev', text: 'Workers in any language, running on compute you already have.' },
  { name: 'Inngest', href: '/docs/alternatives/inngest', text: 'Pull-based workers and server-side flow control on Postgres.' },
  { name: 'iii', href: '/docs/alternatives/iii', text: 'A focused orchestrator for the services you already run.' },
  { name: 'AWS Step Functions', href: '/docs/alternatives/aws-step-functions', text: 'JSON workflows anywhere, with no per-transition bill.' },
  { name: 'Open-source engines', href: '/docs/alternatives/open-source-workflow-engines', text: 'Conductor OSS, Temporal, Airflow, Hatchet and more, side by side.' },
] as const;

export const landingFaq: FaqItem[] = [
  {
    question: 'What is Node Flow?',
    answer:
      'Node Flow (node-flow) is a self-hosted workflow orchestration engine. You describe a process as a declarative JSON DAG, workers in any language poll for the steps they own, and the engine makes every step run, retry, time out and compensate as defined — across restarts, deploys and failures. PostgreSQL 18 is its only infrastructure dependency.',
  },
  {
    question: 'Is Node Flow an alternative to Netflix Conductor and Orkes?',
    answer:
      'Yes. Node Flow follows Conductor’s workflow model and serves a Conductor-compatible REST API at /conductor/api, so supported Conductor SDKs and workers connect with a base-URL change. It replaces Conductor’s Redis, persistence and Elasticsearch stack with a single Postgres database.',
  },
  {
    question: 'How is Node Flow different from Temporal or Trigger.dev?',
    answer:
      'Temporal and Trigger.dev make code durable: the workflow is a function in an SDK. Node Flow makes the workflow a JSON document the engine runs, and workers in any language implement individual steps. That suits processes that cross teams, services and languages, and that operators need to see and act on.',
  },
  {
    question: 'What infrastructure does Node Flow need?',
    answer:
      'Only PostgreSQL 18. Workflow state, task queues, timers, the transactional outbox and search all live in Postgres. There is no Redis, Cassandra, Elasticsearch or Kafka to run.',
  },
  {
    question: 'Which languages can workers be written in?',
    answer:
      'Any. The worker protocol is plain HTTP — lease a task, heartbeat, report a result. There is a TypeScript SDK and generated clients for Python, Go, Java and TypeScript.',
  },
  {
    question: 'Is Node Flow open source and free?',
    answer:
      'Node Flow is free to run, including commercially and inside products you sell. It is source available rather than OSI open source: the code is public and may be redistributed unmodified, but modified versions may not be distributed.',
  },
];

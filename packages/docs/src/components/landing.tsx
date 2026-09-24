'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { comparisons, landingFaq } from '../lib/landing-content';

function Icon({
  name = 'arrow',
  ...props
}: {
  name?: string;
  className?: string;
}) {
  const paths: Record<string, string> = {
    arrow: 'M4 12h15m-6-6 6 6-6 6',
    play: 'm9 5 11 7-11 7V5Z',
    pause: 'M8 5v14M16 5v14',
    check: 'm5 12 4 4L19 6',
    code: 'm8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18',
    globe:
      'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-4 4-4 14 0 18 4-4 4-14 0-18Z',
    flow: 'M4 5h6v6H4zM14 13h6v6h-6zM7 11v5h7',
    book: 'M12 6v15M12 6C9 3 5 3 2 4v15c4-1 7-1 10 2 3-3 6-3 10-2V4c-3-1-7-1-10 2Z',
    database:
      'M20 6c0 2-4 3-8 3S4 8 4 6s4-3 8-3 8 1 8 3ZM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3',
    refresh: 'M20 7v5h-5M20 12a8 8 0 1 0-2 6',
    shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',
    copy: 'M9 9h11v12H9zM5 15H3V3h11v2',
    terminal: 'm5 6 5 6-5 6m8 0h6',
    menu: 'M4 6h16M4 12h16M4 18h16',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.arrow} />
    </svg>
  );
}

function Brand({ priority = false }: { priority?: boolean }) {
  return (
    <Image
      src="/brand/node-flow.png"
      alt="Node Flow"
      width={2172}
      height={724}
      sizes="(max-width: 600px) 114px, 142px"
      priority={priority}
      className="nf-logo"
    />
  );
}

function GitHubLink() {
  return (
    <a
      className="nf-github-link"
      href="https://github.com/dsardar099/node-flow"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="GitHub repository (opens in a new tab)"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.725-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.93 0-1.31.467-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23a11.5 11.5 0 0 1 6 0c2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.922.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
      </svg>
      <span>GitHub</span>
    </a>
  );
}

const examples = [
  {
    title: 'Order fulfilment',
    name: 'fulfil_order',
    icon: 'flow',
    description:
      'Validate an order, charge and reserve in parallel, then bring it all together.',
    tasks: [
      'Validate order',
      'Charge payment',
      'Reserve stock',
      'Join results',
      'Send receipt',
    ],
    refs: [
      'validate_order',
      'charge_payment',
      'reserve_stock',
      'join_results',
      'send_receipt',
    ],
  },
  {
    title: 'Data pipelines',
    name: 'process_document',
    icon: 'database',
    description:
      'Extract a document, enrich it in parallel, and publish the combined result.',
    tasks: [
      'Extract text',
      'Summarize',
      'Create embeddings',
      'Join results',
      'Publish document',
    ],
    refs: [
      'extract_text',
      'summarize',
      'create_embeddings',
      'join_results',
      'publish_document',
    ],
  },
  {
    title: 'Human approvals',
    name: 'approve_release',
    icon: 'shield',
    description:
      'Run checks alongside a human approval. Continue when both are complete.',
    tasks: [
      'Prepare release',
      'Run checks',
      'Human approval',
      'Join results',
      'Deploy release',
    ],
    refs: [
      'prepare_release',
      'run_checks',
      'approve',
      'join_results',
      'deploy_release',
    ],
  },
] as const;
const phases = [0, 1, 1, 2, 3];
const points = [
  [30, 129],
  [255, 49],
  [255, 209],
  [480, 129],
  [705, 129],
];
const edges = [
  'M195 165H220Q230 165 230 155V95Q230 85 240 85H255',
  'M195 165H220Q230 165 230 175V235Q230 245 240 245H255',
  'M420 85H445Q455 85 455 95V155Q455 165 465 165H480',
  'M420 245H445Q455 245 455 235V175Q455 165 465 165H480',
  'M645 165H705',
];

function WorkflowGraph({
  example,
  step,
  backdrop = false,
  compact = false,
}: {
  example: number;
  step: number;
  backdrop?: boolean;
  compact?: boolean;
}) {
  const item = examples[example];
  const dotId = backdrop
    ? 'backdrop-dots'
    : compact
      ? 'compact-dots'
      : 'workflow-dots';
  const layout = compact
    ? [
        [97, 12],
        [10, 122],
        [185, 122],
        [97, 232],
        [97, 342],
      ]
    : points;
  const connectors = compact
    ? [
        'M180 84V103H92V122',
        'M180 84V103H267V122',
        'M92 194V213H180V232',
        'M267 194V213H180V232',
        'M180 304V342',
      ]
    : edges;
  return (
    <svg
      className={
        backdrop
          ? 'nf-background-graph'
          : compact
            ? 'nf-mobile-workflow'
            : 'nf-workflow-graph'
      }
      viewBox={compact ? '0 0 360 430' : '0 0 900 330'}
      aria-hidden={backdrop || undefined}
      role={backdrop ? undefined : 'img'}
      aria-label={
        backdrop
          ? undefined
          : `${item.description} Tasks: ${item.tasks.join(', ')}.`
      }
    >
      <defs>
        <pattern
          id={dotId}
          width="20"
          height="20"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r=".7" fill="#8888a0" opacity=".25" />
        </pattern>
      </defs>
      <rect
        width={compact ? 360 : 900}
        height={compact ? 430 : 330}
        fill={`url(#${dotId})`}
      />
      {connectors.map((d, i) => (
        <g key={d}>
          <path d={d} className="nf-connector" />
          <path d={d} className={`nf-signal nf-signal-${i}`} />
        </g>
      ))}
      {item.tasks.map((task, i) => {
        const done = step > phases[i];
        const active = step === phases[i];
        const [x, y] = layout[i];
        return (
          <g
            key={i}
            transform={`translate(${x} ${y})`}
            className={`nf-graph-node ${done ? 'is-done' : active ? 'is-active' : ''}`}
          >
            <rect width="165" height="72" rx="7" className="nf-node-frame" />
            <rect
              x="12"
              y="13"
              width="24"
              height="24"
              rx="5"
              className="nf-node-icon"
            />
            <text x="24" y="30" textAnchor="middle" className="nf-node-symbol">
              {done
                ? '✓'
                : i === 3
                  ? '⋈'
                  : i === 2 && example === 2
                    ? '◎'
                    : '↗'}
            </text>
            <text x="46" y="23" className="nf-node-type">
              {i === 3 ? 'JOIN' : i === 2 && example === 2 ? 'HUMAN' : 'SIMPLE'}
            </text>
            <text x="46" y="40" className="nf-node-title">
              {task}
            </text>
            <circle cx="18" cy="57" r="2.5" className="nf-node-dot" />
            <text x="27" y="60" className="nf-node-status">
              {done ? 'Completed' : active ? 'Running' : 'Queued'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Definition({ example }: { example: number }) {
  const refs = examples[example].refs;
  const task = (i: number) => ({
    name: refs[i],
    taskReferenceName: refs[i],
    type: example === 2 && i === 2 ? 'HUMAN' : 'SIMPLE',
  });
  const definition = JSON.stringify(
    {
      name: examples[example].name,
      version: 1,
      tasks: [
        task(0),
        {
          name: 'parallel',
          taskReferenceName: 'parallel',
          type: 'FORK_JOIN',
          forkTasks: [[task(1)], [task(2)]],
        },
        {
          name: refs[3],
          taskReferenceName: refs[3],
          type: 'JOIN',
          joinOn: [refs[1], refs[2]],
        },
        task(4),
      ],
    },
    null,
    2,
  );
  return (
    <pre
      className="nf-definition"
      tabIndex={0}
      aria-label="Workflow JSON definition"
    >
      <code>
        {definition.split('\n').map((line, index) => (
          <span className="nf-code-line" key={index}>
            <span className="nf-line-number" aria-hidden="true">
              {index + 1}
            </span>
            <span>
              {line.split(/("[^"]*")/g).map((part, j) => (
                <span
                  key={j}
                  className={
                    part.startsWith('"') ? 'nf-code-string' : undefined
                  }
                >
                  {part}
                </span>
              ))}
            </span>
          </span>
        ))}
      </code>
    </pre>
  );
}

const docs = [
  {
    icon: 'terminal',
    title: 'Your first workflow',
    text: 'From a local stack to a completed run. Follow the code, step by step.',
    href: '/docs/guide/quickstart',
    label: 'Quickstart',
  },
  {
    icon: 'flow',
    title: 'Learn the building blocks',
    text: 'Branches, parallel tasks, waits, retries, and the complete workflow DSL.',
    href: '/docs/guide/workflows',
    label: 'Workflow guide',
  },
  {
    icon: 'code',
    title: 'Explore the API',
    text: 'Endpoints, schemas, and executable requests. Powered by Scalar.',
    href: '/api-reference',
    label: 'API reference',
  },
  {
    icon: 'database',
    title: 'Make it production-ready',
    text: 'Deploy, monitor, secure, and operate your own workflow infrastructure.',
    href: '/docs/guide/self-hosting',
    label: 'Self-hosting',
  },
];

export function LandingPage() {
  const root = useRef<HTMLDivElement>(null);
  const [example, setExample] = useState(0);
  const [view, setView] = useState<'graph' | 'definition'>('graph');
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [demoVisible, setDemoVisible] = useState(true);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = paused || reduced;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    const onVisibility = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    const reveal = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('nf-revealed');
            reveal.unobserve(entry.target);
          }
        }),
      { threshold: 0.12 },
    );
    root.current
      ?.querySelectorAll('[data-reveal]')
      .forEach((el) => reveal.observe(el));
    const demo = new IntersectionObserver(
      ([entry]) => setDemoVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    const preview = root.current?.querySelector('#workflow-preview');
    if (preview) demo.observe(preview);
    return () => {
      media.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', onVisibility);
      reveal.disconnect();
      demo.disconnect();
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    };
  }, []);

  useEffect(() => {
    if (stopped || !visible || !demoVisible) return;
    const timer = setInterval(
      () => setStep((current) => (current + 1) % 6),
      1800,
    );
    return () => clearInterval(timer);
  }, [stopped, visible, demoVisible]);

  useEffect(() => {
    if (!menu) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenu(false);
        root.current
          ?.querySelector<HTMLButtonElement>('.nf-menu-toggle')
          ?.focus();
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [menu]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(
        'docker compose -f docker/docker-compose.yml up',
      );
      setCopied(true);
      setCopyError(false);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <div
      ref={root}
      className="nf-landing"
      data-motion={stopped || !visible ? 'paused' : 'running'}
    >
      <a href="#main-content" className="nf-skip">
        Skip to content
      </a>
      <header className="nf-header">
        <nav
          className="nf-container flex h-[72px] items-center justify-between gap-5"
          aria-label="Main navigation"
        >
          <Link
            href="/"
            aria-label="Node Flow documentation home"
            className="nf-brand"
          >
            <Brand priority />
            <span>DOCUMENTATION</span>
          </Link>
          <div className="nf-desktop-nav flex items-center gap-8">
            <a href="#how-it-works">How it works</a>
            <Link href="/docs/guide">Documentation</Link>
            <Link href="/docs/alternatives">Compare</Link>
            <Link href="/api-reference">API reference</Link>
            <GitHubLink />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="nf-motion"
              onClick={() => setPaused(!paused)}
              disabled={reduced}
              aria-pressed={stopped}
              aria-label={
                reduced
                  ? 'Animations disabled by your system preference'
                  : paused
                    ? 'Resume animations'
                    : 'Pause animations'
              }
              title={stopped ? 'Motion paused' : 'Pause motion'}
            >
              <Icon name={stopped ? 'play' : 'pause'} />
            </button>
            <Link
              href="/docs/guide/quickstart"
              className="nf-button nf-button-small"
            >
              Start building <Icon />
            </Link>
            <button
              className="nf-menu-toggle"
              aria-label="Toggle navigation"
              aria-expanded={menu}
              aria-controls="mobile-navigation"
              onClick={() => setMenu(!menu)}
            >
              <Icon name="menu" />
            </button>
          </div>
        </nav>
        {menu && (
          <nav
            id="mobile-navigation"
            className="nf-mobile-nav"
            aria-label="Mobile navigation"
          >
            <a href="#how-it-works" onClick={() => setMenu(false)}>
              How it works
            </a>
            <Link href="/docs/guide">Documentation</Link>
            <Link href="/docs/alternatives">Compare</Link>
            <Link href="/api-reference">API reference</Link>
            <GitHubLink />
          </nav>
        )}
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="nf-hero">
          <div className="nf-hero-scene" aria-hidden="true">
            <div className="nf-scene-grid" />
            <WorkflowGraph example={0} step={2} backdrop />
            <div className="nf-aurora nf-aurora-blue" />
            <div className="nf-aurora nf-aurora-violet" />
          </div>
          <div className="nf-container nf-hero-content">
            <a
              className="nf-announcement nf-enter"
              href="/docs/contributing/architecture"
            >
              <span className="nf-status-dot" /> Source available. Built on
              Postgres. <Icon />
            </a>
            <h1
              className="nf-enter"
              style={{ '--entry': '90ms' } as CSSProperties}
            >
              Complex workflows.
              <br />
              <span>Beautifully orchestrated.</span>
            </h1>
            <p
              className="nf-enter nf-hero-description"
              style={{ '--entry': '180ms' } as CSSProperties}
            >
              A self-hosted workflow orchestration engine that runs on Postgres
              alone.
              <br className="nf-desktop-break" /> Durable workflows, workers in
              any language, and just one dependency.
            </p>
            <div
              className="nf-hero-actions nf-enter"
              style={{ '--entry': '270ms' } as CSSProperties}
            >
              <Link href="/docs/guide/quickstart" className="nf-button">
                Build your first workflow <Icon />
              </Link>
              <Link className="nf-button nf-button-quiet" href="/docs/guide">
                <Icon name="book" /> Read the documentation
              </Link>
            </div>
            <div
              className="nf-hero-facts nf-enter"
              style={{ '--entry': '360ms' } as CSSProperties}
            >
              <span>
                <Icon name="check" /> Source available
              </span>
              <span>
                <Icon name="check" /> Self-hostable
              </span>
              <span>
                <Icon name="check" /> Postgres-powered
              </span>
            </div>
          </div>
        </section>

        <section
          id="workflow-preview"
          className="nf-container nf-preview-section nf-enter"
          style={{ '--entry': '450ms' } as CSSProperties}
          aria-label="Interactive workflow example"
        >
          <div className="nf-example-tabs" aria-label="Workflow examples">
            {examples.map((item, i) => (
              <button
                key={item.name}
                type="button"
                aria-pressed={example === i}
                onClick={() => {
                  setExample(i);
                  setStep(0);
                }}
              >
                <Icon name={item.icon} />
                {item.title}
                <span className="nf-tab-indicator" />
              </button>
            ))}
          </div>
          <div className="nf-preview">
            <div className="nf-preview-top">
              <div className="flex items-center gap-3">
                <span className="nf-app-icon">
                  <Icon name="flow" />
                </span>
                <span className="nf-preview-breadcrumb">
                  Workflows <span>/</span>
                </span>
                <strong>{examples[example].name}</strong>
                <span className="nf-version">v1</span>
              </div>
              <span className="nf-demo-label">
                <span className="nf-status-dot" /> Interactive demo
              </span>
            </div>
            <div className="nf-preview-body">
              <aside className="nf-preview-sidebar" aria-label="Example tasks">
                <span className="nf-label">EXECUTION PLAN</span>
                {examples[example].tasks.map((task, i) => (
                  <div
                    className={`nf-task-row ${step === phases[i] ? 'is-active' : ''}`}
                    key={task}
                  >
                    <span className="nf-task-state">
                      {step > phases[i] ? (
                        <Icon name="check" />
                      ) : (
                        <span>{String(i + 1).padStart(2, '0')}</span>
                      )}
                    </span>
                    <span>{task}</span>
                  </div>
                ))}
                <div className="nf-sidebar-note">
                  <Icon name="database" />
                  <span>
                    State persisted
                    <br />
                    <strong>PostgreSQL</strong>
                  </span>
                </div>
              </aside>
              <div className="nf-preview-main">
                <div className="nf-view-toolbar">
                  <div className="nf-view-switch" aria-label="Preview view">
                    <button
                      aria-pressed={view === 'graph'}
                      onClick={() => setView('graph')}
                    >
                      <Icon name="flow" /> Workflow
                    </button>
                    <button
                      aria-pressed={view === 'definition'}
                      onClick={() => setView('definition')}
                    >
                      <Icon name="code" /> Definition
                    </button>
                  </div>
                  <button className="nf-replay" onClick={() => setStep(0)}>
                    <Icon name="refresh" /> Replay
                  </button>
                </div>
                <div className="nf-graph-viewport">
                  {view === 'graph' ? (
                    <>
                      <WorkflowGraph example={example} step={step} />
                      <WorkflowGraph example={example} step={step} compact />
                    </>
                  ) : (
                    <Definition example={example} />
                  )}
                </div>
                <div className="nf-execution-bar">
                  <span>
                    <span className="nf-status-dot" />
                    {stopped
                      ? 'Animation paused'
                      : step >= 4
                        ? 'Workflow completed'
                        : `Running: ${examples[example].tasks[phases.indexOf(step)]}`}
                  </span>
                  <span className="nf-execution-count">
                    {phases.filter((phase) => step > phase).length} / 5 tasks
                    complete
                  </span>
                </div>
                <div className="nf-execution-progress" aria-hidden="true">
                  <span
                    style={{
                      width: `${phases.filter((phase) => step > phase).length * 20}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="nf-preview-caption">
            {examples[example].description}
            <span>Illustrative execution · no server required</span>
          </p>
        </section>

        <div className="nf-container nf-stack" data-reveal>
          <span>YOUR LOGIC. YOUR LANGUAGE.</span>
          <div>
            {['TypeScript', 'Python', 'Go', 'Java', 'Rust', 'HTTP'].map(
              (name) => (
                <span key={name}>
                  <span
                    className={`nf-language-icon nf-language-icon-${name.toLowerCase()}`}
                    aria-hidden="true"
                  >
                    {name === 'HTTP' ? (
                      <Icon name="globe" />
                    ) : (
                      <Image
                        src={`/brand/languages/${name.toLowerCase()}.svg`}
                        alt=""
                        width={32}
                        height={32}
                        unoptimized
                      />
                    )}
                  </span>
                  {name}
                </span>
              ),
            )}
          </div>
          <p>One worker protocol. Endless possibilities.</p>
        </div>

        <section id="how-it-works" className="nf-container nf-section">
          <div className="nf-section-head" data-reveal>
            <span className="nf-eyebrow">01 / THE DEVELOPER EXPERIENCE</span>
            <h2>
              You write the work.
              <br />
              <span>Node Flow connects it.</span>
            </h2>
            <p>
              From a simple sequence to a sprawling graph, the same clear model
              takes you from definition to execution.
            </p>
          </div>
          <div className="nf-capabilities grid grid-cols-1 lg:grid-cols-3">
            <article className="nf-capability" data-reveal>
              <div className="nf-mini nf-mini-fork" aria-hidden="true">
                <span>INPUT</span>
                <i />
                <div>
                  <b>task A</b>
                  <b>task B</b>
                  <b>task C</b>
                </div>
                <i />
                <span>JOIN</span>
              </div>
              <span className="nf-label">DECLARE</span>
              <h3>A graph you can reason about.</h3>
              <p>
                Express branches, parallel work, loops, and human approvals in
                inspectable JSON.
              </p>
              <Link href="/docs/guide/workflows">
                Explore the workflow DSL <Icon />
              </Link>
            </article>
            <article className="nf-capability" data-reveal>
              <div className="nf-mini nf-mini-retry" aria-hidden="true">
                <span>ATTEMPT 01</span>
                <div>
                  <b>interrupted</b>
                  <i />
                  <b>retrying</b>
                  <i />
                  <b>completed</b>
                </div>
                <span className="nf-retry-line" />
              </div>
              <span className="nf-label">EXECUTE</span>
              <h3>Built for the unexpected.</h3>
              <p>
                Durable state, task leases, and configurable retries keep
                distributed work moving.
              </p>
              <Link href="/docs/guide/execution-controls">
                Understand execution <Icon />
              </Link>
            </article>
            <article className="nf-capability" data-reveal>
              <div className="nf-mini nf-mini-trace" aria-hidden="true">
                {[65, 90, 48, 78].map((width, i) => (
                  <div key={i}>
                    <span>0{i + 1}</span>
                    <i
                      style={
                        {
                          '--bar-width': `${width}%`,
                          '--bar-delay': `${i * 0.35}s`,
                        } as CSSProperties
                      }
                    />
                    <span>✓</span>
                  </div>
                ))}
              </div>
              <span className="nf-label">OBSERVE</span>
              <h3>Every run tells a story.</h3>
              <p>
                Follow execution history, inspect task outputs, and retry from
                the point that matters.
              </p>
              <Link href="/docs/guide/execution-controls">
                Take control of a run <Icon />
              </Link>
            </article>
          </div>
        </section>

        <section className="nf-infrastructure">
          <div className="nf-container grid items-center gap-16 lg:grid-cols-2">
            <div className="nf-infra-copy" data-reveal>
              <span className="nf-eyebrow">
                02 / RADICALLY SIMPLE INFRASTRUCTURE
              </span>
              <h2>
                Big workflows.
                <br />
                <span>Small footprint.</span>
              </h2>
              <p>
                Queues, timers, workflow state, and the outbox. All backed by
                Postgres. One transactional foundation for the whole system.
              </p>
              <div className="nf-infra-points">
                <span>
                  <Icon name="check" /> One required infrastructure dependency
                </span>
                <span>
                  <Icon name="check" /> Pure, deterministic decision engine
                </span>
                <span>
                  <Icon name="check" /> Scale API, decider, and poller
                  independently
                </span>
              </div>
              <Link
                className="nf-text-link"
                href="/docs/contributing/architecture"
              >
                Go inside the architecture <Icon />
              </Link>
            </div>
            <div
              className="nf-orbit-diagram"
              data-reveal
              role="img"
              aria-label="Postgres stores workflow state, queues, timers, and the outbox"
            >
              <div className="nf-orbit nf-orbit-one" />
              <div className="nf-orbit nf-orbit-two" />
              <div className="nf-orbit nf-orbit-three" />
              <div className="nf-orbit-satellite nf-orbit-satellite-one">
                <i />
              </div>
              <div className="nf-orbit-satellite nf-orbit-satellite-two">
                <i />
              </div>
              <div className="nf-pg-core">
                <Icon name="database" />
                <strong>Postgres</strong>
                <span>
                  ONE SOURCE
                  <br />
                  OF TRUTH
                </span>
              </div>
              {[
                'Workflow state',
                'Task queues',
                'Durable timers',
                'Transactional outbox',
              ].map((name, i) => (
                <span
                  key={name}
                  className={`nf-orbit-label nf-orbit-label-${i}`}
                >
                  <span className="nf-status-dot" />
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="nf-container nf-section nf-get-started">
          <div className="nf-section-head" data-reveal>
            <span className="nf-eyebrow">
              03 / A SHORT PATH TO YOUR FIRST RUN
            </span>
            <h2>
              Less setup.
              <br />
              <span>More shipping.</span>
            </h2>
          </div>
          <div className="nf-start-grid grid gap-12 md:grid-cols-2">
            <div className="nf-steps" data-reveal>
              {[
                {
                  title: 'Start your local stack',
                  body: 'Bring up Postgres, the server, and the dashboard with Docker Compose.',
                },
                {
                  title: 'Define the workflow',
                  body: 'Describe your tasks in JSON. Register the definition with the API.',
                },
                {
                  title: 'Connect a worker. Watch it flow.',
                  body: 'Lease a task, execute your logic, and report the result.',
                },
              ].map((s, i) => (
                <div key={s.title}>
                  <span>{i + 1}</span>
                  <section>
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </section>
                </div>
              ))}
              <Link href="/docs/guide/quickstart" className="nf-text-link">
                Follow the complete quickstart <Icon />
              </Link>
            </div>
            <div className="nf-terminal" data-reveal>
              <div className="nf-terminal-header">
                <span>
                  <i />
                  <i />
                  <i />
                </span>
                <span>YOUR TERMINAL</span>
                <Icon name="terminal" />
              </div>
              <div className="nf-terminal-content">
                <span className="nf-code-comment">
                  # From a checkout of the repository
                </span>
                <div className="nf-terminal-command">
                  <span>$</span>
                  <code>docker compose -f docker/docker-compose.yml up</code>
                  <button
                    onClick={copyCommand}
                    aria-label="Copy Docker Compose command"
                  >
                    <Icon name={copied ? 'check' : 'copy'} />
                  </button>
                </div>
                <div
                  className="nf-terminal-output"
                  aria-label="Example startup output"
                >
                  <p>
                    <Icon name="check" />
                    <span>Postgres</span>
                    <b>ready</b>
                  </p>
                  <p>
                    <Icon name="check" />
                    <span>Node Flow server</span>
                    <b>:3000</b>
                  </p>
                  <p>
                    <Icon name="check" />
                    <span>Dashboard</span>
                    <b>:3100</b>
                  </p>
                </div>
                <div className="nf-terminal-prompt">
                  <span>$</span>
                  <i />
                </div>
                <span className="nf-copy-feedback" role="status">
                  {copied
                    ? 'Command copied'
                    : copyError
                      ? 'Select the command above to copy it.'
                      : 'Example output · Docker Compose starts three services'}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="nf-container nf-section nf-docs-section"
          id="documentation"
        >
          <div className="nf-docs-heading" data-reveal>
            <div>
              <span className="nf-eyebrow">THE NEXT STEP IS YOURS</span>
              <h2>
                Built for builders.
                <br />
                <span>Documented for humans.</span>
              </h2>
            </div>
            <Link href="/docs/guide" className="nf-text-link">
              All documentation <Icon />
            </Link>
          </div>
          <div className="nf-docs-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {docs.map((item, i) => (
              <Link
                key={item.title}
                href={item.href}
                className="nf-doc-card"
                data-reveal
                style={{ '--reveal-delay': `${i * 70}ms` } as CSSProperties}
              >
                <span className="nf-doc-icon">
                  <Icon name={item.icon} />
                </span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <span className="nf-doc-link">
                  {item.label}
                  <Icon />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section
          className="nf-container nf-section nf-docs-section"
          id="compare"
          aria-labelledby="compare-heading"
        >
          <div className="nf-docs-heading" data-reveal>
            <div>
              <span className="nf-eyebrow">04 / HOW IT COMPARES</span>
              <h2 id="compare-heading">
                A Conductor, Temporal and
                <br />
                <span>Trigger.dev alternative.</span>
              </h2>
            </div>
            <Link href="/docs/alternatives" className="nf-text-link">
              All comparisons <Icon />
            </Link>
          </div>
          <div className="nf-docs-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {comparisons.map((item, i) => (
              <Link
                key={item.href}
                href={item.href}
                className="nf-doc-card"
                data-reveal
                style={
                  { '--reveal-delay': `${(i % 4) * 70}ms` } as CSSProperties
                }
              >
                <span className="nf-doc-icon">
                  <Icon name="refresh" />
                </span>
                <h3>
                  {item.name === 'Open-source engines'
                    ? 'Open-source workflow engines'
                    : `${item.name} alternative`}
                </h3>
                <p>{item.text}</p>
                <span className="nf-doc-link">
                  node-flow vs {item.name}
                  <Icon />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section
          className="nf-container nf-section nf-docs-section nf-faq"
          id="faq"
          aria-labelledby="faq-heading"
        >
          <div className="nf-docs-heading" data-reveal>
            <div>
              <span className="nf-eyebrow">05 / QUESTIONS</span>
              <h2 id="faq-heading">
                Frequently asked.
                <br />
                <span>Plainly answered.</span>
              </h2>
            </div>
          </div>
          <div className="nf-faq-list">
            {landingFaq.map((item) => (
              <details key={item.question} className="nf-faq-item" data-reveal>
                <summary>
                  <h3>{item.question}</h3>
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="nf-final">
          <div className="nf-final-rings" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="nf-container" data-reveal>
            <span className="nf-eyebrow">YOUR INFRASTRUCTURE. YOUR RULES.</span>
            <h2>Let it flow.</h2>
            <p>Your next workflow starts with a single step.</p>
            <Link className="nf-button" href="/docs/guide/quickstart">
              Start building with Node Flow <Icon />
            </Link>
          </div>
        </section>
        <section
          className="nf-container nf-maker"
          aria-labelledby="maker-heading"
        >
          <div className="nf-maker-card" data-reveal>
            <div className="nf-maker-mark">
              <span className="nf-maker-portrait">
                <Image
                  src="/brand/dwaipayan-sardar.jpg"
                  alt="Dwaipayan Sardar"
                  width={1122}
                  height={1402}
                  sizes="(max-width: 600px) 68px, 93px"
                />
              </span>
            </div>
            <div className="nf-maker-copy">
              <span className="nf-eyebrow">BEHIND THE FLOW</span>
              <h2 id="maker-heading">Dwaipayan Sardar</h2>
              <p>Built with curiosity. Shared with the world.</p>
            </div>
            <a
              className="nf-maker-link"
              href="https://www.dwaipayan.in/"
              target="_blank"
              rel="noopener noreferrer"
            >
              <span>
                Meet the builder
                <span className="nf-maker-domain">dwaipayan.in</span>
              </span>
              <Icon />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </div>
        </section>
      </main>
      <footer className="nf-container nf-footer">
        <Link href="/" aria-label="Node Flow home">
          <Brand />
        </Link>
        <p>
          Source available. Free to run, including commercially. Built to keep
          work moving.
        </p>
        <nav aria-label="Footer navigation">
          <Link href="/docs/guide">Docs</Link>
          <Link href="/docs/alternatives">Compare</Link>
          <Link href="/api-reference">API</Link>
          <Link href="/docs/contributing">Contribute</Link>
          <GitHubLink />
        </nav>
      </footer>
    </div>
  );
}

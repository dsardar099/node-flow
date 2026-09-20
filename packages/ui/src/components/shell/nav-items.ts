import {
  Sparkles,
  BookOpen,
  CommentDot,
  Database,
  Molecule,
  BranchesRight,
  Calendar,
  Cube,
  CurlyBrackets,
  Cpu,
  FileCode,
  Globe,
  House,
  Key,
  LockOpen,
  Persons,
  ShieldCheck,
  ListUl,
  Link as LinkIcon,
  Person,
  Pulse,
  BroadcastSignal,
  Signal,
  Server,
  Tag,
  Thunderbolt,
} from '@gravity-ui/icons';
import type { ComponentType, SVGProps } from 'react';

/**
 * The navigation, in two groups: **Operate** — what is running and what needs
 * attention — and **Build** — the definitions that shape it. Every item is
 * gated on a scope, because a menu that leads to a 403 teaches people to
 * distrust the navigation. Only screens that exist are listed.
 */

export interface NavItem {
  href: string;
  label: string;
  scope: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Further paths that highlight this item, such as its detail pages. */
  matches?: string[];
  external?: boolean;
  /** Also shown to someone holding a resource grant of this kind, without the scope. */
  grant?: { type: 'WORKFLOW' | 'TASK_DEFINITION'; access: 'READ' | 'EXECUTE' | 'UPDATE' | 'DELETE' };
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    key: 'operate',
    label: 'Operate',
    items: [
      { href: '/overview', label: 'Overview', scope: 'executions:read', icon: House },
      {
        href: '/executions',
        label: 'Executions',
        scope: 'executions:read',
        icon: Pulse,
        matches: ['/execution/'],
        grant: { type: 'WORKFLOW', access: 'READ' },
      },
      { href: '/human/tasks', label: 'Human tasks', scope: 'human-tasks:read', icon: Person },
      { href: '/taskQueue', label: 'Queues', scope: 'executions:read', icon: Server },
      { href: '/workers', label: 'Workers', scope: 'executions:read', icon: Cpu },
      { href: '/eventMonitor', label: 'Event monitor', scope: 'workflows:read', icon: BroadcastSignal },
    ],
  },
  {
    key: 'build',
    label: 'Build',
    items: [
      {
        href: '/workflowDef',
        label: 'Workflows',
        scope: 'workflows:read',
        icon: BranchesRight,
        matches: ['/workflowDef/', '/newWorkflowDef'],
        grant: { type: 'WORKFLOW', access: 'READ' },
      },
      {
        href: '/taskDef',
        label: 'Task definitions',
        scope: 'workflows:read',
        icon: Cube,
        matches: ['/taskDef/', '/newTaskDef'],
        grant: { type: 'TASK_DEFINITION', access: 'READ' },
      },
      { href: '/scheduleDef', label: 'Schedules', scope: 'workflows:read', icon: Calendar, matches: ['/scheduleDef/'] },
      {
        href: '/eventHandlerDef',
        label: 'Event handlers',
        scope: 'workflows:read',
        icon: Thunderbolt,
        matches: ['/eventHandlerDef/'],
      },
      { href: '/webhooks', label: 'Webhooks', scope: 'workflows:read', icon: LinkIcon },
      { href: '/statusListeners', label: 'Status listeners', scope: 'workflows:read', icon: Signal },
      { href: '/forms', label: 'User forms', scope: 'workflows:read', icon: ListUl, matches: ['/forms/', '/newForm'] },
      { href: '/schemas', label: 'Schemas', scope: 'workflows:read', icon: FileCode },
      { href: '/environment', label: 'Environment', scope: 'workflows:read', icon: CurlyBrackets },
    ],
  },
  {
    key: 'ai',
    label: 'AI',
    items: [
      { href: '/ai/assistant', label: 'Assistant', scope: 'workflows:read', icon: Sparkles },
      { href: '/ai/integrations', label: 'Integrations', scope: 'workflows:read', icon: Molecule },
      { href: '/ai/prompts', label: 'Prompts', scope: 'workflows:read', icon: CommentDot, matches: ['/ai/prompts/'] },
      { href: '/ai/indexes', label: 'Vector indexes', scope: 'workflows:read', icon: Database, matches: ['/ai/indexes/'] },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    items: [
      // `platform:admin`, which `admin` deliberately does not satisfy — a
      // tenant's administrator must not be able to create or list tenants.
      { href: '/admin/namespaces', label: 'Namespaces', scope: 'platform:admin', icon: Globe },
      { href: '/admin/users', label: 'Users', scope: 'admin', icon: Person },
      { href: '/admin/groups', label: 'Groups', scope: 'admin', icon: Persons },
      { href: '/admin/tags', label: 'Tags', scope: 'admin', icon: Tag },
      { href: '/admin/permissions', label: 'Permissions', scope: 'admin', icon: ShieldCheck },
      { href: '/admin/applications', label: 'Applications', scope: 'admin', icon: Key },
      { href: '/admin/secrets', label: 'Secrets', scope: 'admin', icon: LockOpen },
      { href: '/admin/audit', label: 'Audit log', scope: 'admin', icon: ShieldCheck },
    ],
  },
  {
    key: 'resources',
    label: 'Resources',
    items: [{ href: '/api-reference', label: 'API reference', scope: 'executions:read', icon: BookOpen }],
  },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (pathname === item.href) return true;
  return (item.matches ?? []).some((prefix) => pathname.startsWith(prefix));
}

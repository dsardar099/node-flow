'use client';

import {
  ArrowRightFromSquare,
  Bars,
  ChevronsExpandVertical,
  ChevronsLeft,
  ChevronsRight,
  Magnifier,
  Persons,
} from '@gravity-ui/icons';
import {
  Avatar,
  Button,
  Drawer,
  Dropdown,
  Kbd,
  Label,
  Link,
  Tooltip,
} from '@heroui/react';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { can, canUse, type CurrentUser } from '../../lib/access';
import { mutate } from '../../lib/mutate';
import { BrandLockup, BrandMark } from './brand';
import { CommandPalette } from './command-palette';
import { NAV, isActive } from './nav-items';
import { ThemeMenu } from './theme';
import { triggerClass } from '../ui/dropdown-trigger';

/**
 * The sidebar.
 *
 * Collapsible to an icon rail, remembered per browser. The collapsed state is
 * read after mount — the server render cannot know it, and reading it during
 * render would mismatch hydration.
 */
export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('nf.sidebar.collapsed') === '1');
    } catch {
      /* storage unavailable — stay expanded */
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggle = () =>
    setCollapsed((value) => {
      try {
        localStorage.setItem('nf.sidebar.collapsed', value ? '0' : '1');
      } catch {
        /* storage unavailable */
      }
      return !value;
    });

  const groups = NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => canUse(user, item.scope, item.grant)),
  })).filter((group) => group.items.length > 0);

  const [mobileOpen, setMobileOpen] = useState(false);
  // A link followed from the drawer should close it; the route change is the signal.
  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <>
      <MobileBar
        user={user}
        groups={groups}
        pathname={pathname}
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        onSearch={() => setPaletteOpen(true)}
      />
      <aside
        className={`hidden shrink-0 flex-col md:flex border-r border-separator bg-surface transition-[width] duration-200 ${
          collapsed ? 'w-[68px]' : 'w-64'
        }`}
      >
        <div
          className={`flex items-center gap-2.5 px-4 pb-2 pt-2 ${collapsed ? 'justify-center px-0' : ''}`}
        >
          {/*
            The logo alone, at a size you can actually read it at.

            This previously showed the mark *and* the lockup *and* the namespace
            stacked in a 32px-tall row, which made a tiny swirl sit beside a
            tiny wordmark and read as a rendering fault. The lockup already
            contains the mark, and the namespace is on the account block at the
            bottom of this same sidebar — so neither belongs here.
          */}
          {collapsed ? <BrandMark size={50} /> : <BrandLockup height={55} />}
        </div>

        <div className={collapsed ? 'flex justify-center pb-2' : 'px-3 pb-2'}>
          {collapsed ? (
            <NavTooltip label="Search  ⌘K">
              <Button
                isIconOnly
                variant="ghost"
                aria-label="Search"
                onPress={() => setPaletteOpen(true)}
              >
                <Magnifier />
              </Button>
            </NavTooltip>
          ) : (
            <Button
              variant="tertiary"
              fullWidth
              className="justify-between text-muted"
              onPress={() => setPaletteOpen(true)}
            >
              <span className="flex items-center gap-2">
                <Magnifier />
                Search
              </span>
              <Kbd>
                <Kbd.Abbr keyValue="command" />
                <Kbd.Content>K</Kbd.Content>
              </Kbd>
            </Button>
          )}
        </div>

        <nav
          aria-label="Main"
          className="flex-1 space-y-5 overflow-y-auto px-3 py-2"
        >
          {groups.map((group) => (
            <div key={group.key}>
              {!collapsed && (
                <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item, pathname);
                  const Icon = item.icon;
                  const link = (
                    <Link
                      href={item.href}
                      target={item.external ? '_blank' : undefined}
                      aria-current={active ? 'page' : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={`group flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm no-underline transition-colors ${
                        collapsed ? 'justify-center' : ''
                      } ${
                        active
                          ? 'bg-accent-soft font-medium text-accent-soft-foreground'
                          : 'text-foreground/80 hover:bg-default hover:text-foreground'
                      }`}
                    >
                      <Icon
                        className={`size-4 shrink-0 ${active ? '' : 'text-muted group-hover:text-foreground'}`}
                      />
                      {!collapsed && (
                        <span className="truncate">{item.label}</span>
                      )}
                    </Link>
                  );
                  return (
                    <li key={item.href}>
                      {collapsed ? (
                        <NavTooltip label={item.label}>{link}</NavTooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/*
          Two sections, not one. Appearance and the account are unrelated
          controls that happened to share a box, and reading them as a single
          block is what made the theme row look like a caption on the avatar.
          A rule between them says they are separate things.
        */}
        <div className="mt-auto shrink-0">
          <div
            className={`flex items-center border-t border-separator px-3 py-2 ${
              collapsed ? 'flex-col gap-1.5 px-2' : 'justify-between gap-2'
            }`}
          >
            <ThemeMenu compact={collapsed} />
            <NavTooltip
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onPress={toggle}
              >
                {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
              </Button>
            </NavTooltip>
          </div>

          <div
            className={`border-t border-separator p-2 ${collapsed ? 'flex justify-center' : ''}`}
          >
            <UserMenu user={user} collapsed={collapsed} />
          </div>
        </div>

        <CommandPalette
          isOpen={paletteOpen}
          onOpenChange={setPaletteOpen}
          user={user}
        />
      </aside>
    </>
  );
}

function NavTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger>{children}</Tooltip.Trigger>
      <Tooltip.Content placement="right">{label}</Tooltip.Content>
    </Tooltip>
  );
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'
  );
}

/**
 * What this account *is*, in two words.
 *
 * The line under the name used to read "Signed in" — which the presence of the
 * whole application already says, so it was a row of pixels spent on nothing.
 * The scopes are the useful fact: they decide what the rest of this sidebar
 * even shows, and "Read only" explains a missing button better than the
 * missing button does.
 */
function roleLabel(user: CurrentUser): string {
  // A token or application is not a person; saying which kind matters more
  // than what it may do.
  if (user.type !== 'USER') return sentenceCase(user.type);
  if (user.scopes.includes('admin')) return 'Administrator';
  if (user.scopes.some((s) => s.endsWith(':write') || s.endsWith(':*')))
    return 'Operator';
  if (user.scopes.length > 0) return 'Read only';
  return (user.resourceGrants?.length ?? 0) > 0 ? 'Limited access' : 'No access';
}

function sentenceCase(value: string): string {
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function signOut(user: CurrentUser): Promise<void> {
  await mutate(`/v1/ns/${user.namespace}/users/logout`).catch(() => undefined);
  // A full load, not a router push: the point is to drop every cache and
  // every piece of client state belonging to the session just ended.
  window.location.href = '/login';
}

/**
 * The signed-in account, as a menu.
 *
 * Three things were wrong with the block this replaces, and only the last one
 * was visible. The avatar sat above the email rather than beside it and the
 * email ran past the sidebar instead of truncating — both because
 * `Dropdown.Trigger` lays its children out as blocks unless told otherwise
 * (see `ui/dropdown-trigger.ts`). And the menu it opened held exactly one
 * item, so the chevron promised more than it had.
 *
 * **There is no settings route to link to.** `src/app` has no `/settings` and
 * no per-user page; the nearest real screen is the admin user list, and it is
 * offered only to someone who may open it. An earlier version of this menu
 * shipped a link to a route that did not exist, so the rule here is that every
 * entry is a path that exists *and* a scope the reader holds.
 */
function UserMenu({
  user,
  collapsed = false,
}: {
  user: CurrentUser;
  collapsed?: boolean;
}) {
  const role = roleLabel(user);
  const isAdmin = can(user, 'admin');
  // An account literally named "Administrator" would otherwise print its own
  // name twice and read as a rendering bug. The namespace is the next most
  // useful thing to say about it.
  const subtitle =
    role.toLowerCase() === user.name.toLowerCase() ? user.namespace : role;

  const trigger = (
    <Dropdown.Trigger
      aria-label={`Account: ${user.name}`}
      className={`${triggerClass({
        variant: 'ghost',
        isIconOnly: collapsed,
      })} ${collapsed ? '' : 'h-auto w-full justify-start gap-2.5 px-2 py-2'}`}
    >
      <Avatar size="sm" color="accent" className="shrink-0">
        <Avatar.Fallback>{initials(user.name)}</Avatar.Fallback>
      </Avatar>
      {!collapsed && (
        <>
          {/* `min-w-0` is what lets the two lines truncate: without it this
              column's base size is its widest line and a long email pushes
              the chevron out of the sidebar. */}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
            <span className="truncate text-sm font-medium leading-tight text-foreground">
              {user.name}
            </span>
            <span className="truncate text-xs font-normal leading-tight text-muted">
              {subtitle}
            </span>
          </span>
          <ChevronsExpandVertical
            aria-hidden
            className="size-4 shrink-0 text-muted"
          />
        </>
      )}
    </Dropdown.Trigger>
  );

  return (
    <Dropdown>
      {collapsed ? (
        <NavTooltip label={`${user.name} — ${role}`}>{trigger}</NavTooltip>
      ) : (
        trigger
      )}
      <Dropdown.Popover placement="top start" className="min-w-60">
        {/* Outside the menu, because it is not a choice: a heading among
            focusable items is a stop on the way to the one that signs you out. */}
        <div className="border-b border-separator px-3 py-2.5">
          <p className="truncate text-sm font-medium" title={user.name}>
            {user.name}
          </p>
          <p className="truncate text-xs text-muted">
            {role} · {user.namespace}
          </p>
        </div>
        <Dropdown.Menu
          aria-label="Account"
          onAction={(key) => {
            if (key === 'sign-out') void signOut(user);
          }}
        >
          {isAdmin ? (
            <Dropdown.Item
              id="users"
              href="/admin/users"
              textValue="Users and access"
            >
              <Persons />
              <Label>Users and access</Label>
            </Dropdown.Item>
          ) : null}
          <Dropdown.Item id="sign-out" textValue="Sign out" variant="danger">
            <ArrowRightFromSquare />
            <Label>Sign out</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

type NavGroups = {
  key: string;
  label: string;
  items: (typeof NAV)[number]['items'];
}[];

/**
 * Below `md`: a slim top bar, with the navigation in a drawer.
 *
 * A 256px sidebar on a 390px phone leaves the page 130px to work with, which
 * is no page at all. The drawer holds the same groups and scopes as the
 * sidebar, so nothing is reachable on one and not the other.
 */
function MobileBar({
  user,
  groups,
  pathname,
  open,
  onOpenChange,
  onSearch,
}: {
  user: CurrentUser;
  groups: NavGroups;
  pathname: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSearch: () => void;
}) {
  const current = groups
    .flatMap((g) => g.items)
    .find((item) => isActive(item, pathname));

  return (
    <>
      <header className="flex shrink-0 items-center gap-2 border-b border-separator bg-surface px-3 py-2 md:hidden">
        <Button
          isIconOnly
          variant="ghost"
          aria-label="Open navigation"
          onPress={() => onOpenChange(true)}
        >
          <Bars />
        </Button>
        <BrandMark size={28} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {current?.label ?? 'node-flow'}
        </span>
        <Button
          isIconOnly
          variant="ghost"
          aria-label="Search"
          onPress={onSearch}
        >
          <Magnifier />
        </Button>
      </header>

      <Drawer.Backdrop isOpen={open} onOpenChange={onOpenChange}>
        <Drawer.Content placement="left">
          <Drawer.Dialog className="w-[18rem] max-w-[85vw]">
            <Drawer.CloseTrigger />
            <Drawer.Header>
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="grid size-8 place-items-center rounded-xl bg-accent text-sm font-bold text-accent-foreground"
                >
                  nf
                </span>
                <div className="min-w-0 leading-tight">
                  <Drawer.Heading className="text-sm font-semibold">
                    node-flow
                  </Drawer.Heading>
                  <p className="truncate text-xs text-muted">
                    {user.namespace} · {user.name}
                  </p>
                </div>
              </div>
            </Drawer.Header>
            <Drawer.Body>
              <nav aria-label="Main" className="space-y-5">
                {groups.map((group) => (
                  <div key={group.key}>
                    <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted">
                      {group.label}
                    </p>
                    <ul className="space-y-0.5">
                      {group.items.map((item) => {
                        const active = isActive(item, pathname);
                        const Icon = item.icon;
                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              target={item.external ? '_blank' : undefined}
                              aria-current={active ? 'page' : undefined}
                              className={`flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm no-underline ${
                                active
                                  ? 'bg-accent-soft font-medium text-accent-soft-foreground'
                                  : 'text-foreground/80 hover:bg-default'
                              }`}
                            >
                              <Icon
                                className={`size-4 shrink-0 ${active ? '' : 'text-muted'}`}
                              />
                              {item.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </nav>
            </Drawer.Body>
            {/* The same two sections as the sidebar, in the same order, so
                the phone and the desktop do not disagree about where the
                account lives. */}
            <Drawer.Footer className="flex flex-col items-stretch gap-1 p-2">
              <div className="px-1">
                <ThemeMenu compact={false} />
              </div>
              <div className="border-t border-separator pt-1">
                <UserMenu user={user} />
              </div>
            </Drawer.Footer>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  );
}

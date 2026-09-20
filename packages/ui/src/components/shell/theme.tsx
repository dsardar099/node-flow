'use client';

import { Display, Moon, Sun } from '@gravity-ui/icons';
import { Dropdown, Label, Tooltip } from '@heroui/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { triggerClass } from '../ui/dropdown-trigger';

/**
 * Light, dark, or follow the system.
 *
 * Applied by an inline script in `<head>` before the page paints, so a dark
 * user never sees a white flash on load — which a theme applied from React
 * after hydration always produces.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'nf.theme';

export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem('${KEY}')||'system';var d=c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);var e=document.documentElement;e.classList.toggle('dark',d);e.classList.toggle('light',!d);e.dataset.theme=d?'dark':'light';}catch(_){}})();`;

function apply(choice: ThemeChoice) {
  const dark =
    choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
  root.dataset.theme = dark ? 'dark' : 'light';
}

/**
 * The theme actually in effect, following changes live.
 *
 * For components that take a colour mode of their own. React Flow, left at its
 * default, puts a `light` class on its root — and HeroUI's `.light` selector
 * then redefines every token inside it, so the diagram stayed white in dark mode.
 *
 * The correction runs in a *layout* effect for the same reason `Providers`
 * re-applies the theme in one: the server cannot know which mode this browser
 * is in, so the first client render has to say `light` and be fixed afterwards.
 * A passive effect fixes it one paint too late, and that paint is a white
 * diagram on a dark page — brief, and unmistakable.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useLayoutEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** Applies whatever theme this browser last chose. */
export function applyStoredTheme(): void {
  let choice: ThemeChoice = 'system';
  try {
    choice = (localStorage.getItem(KEY) as ThemeChoice | null) ?? 'system';
  } catch {
    /* storage unavailable */
  }
  apply(choice);
}

export function ThemeMenu({ compact }: { compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>('system');

  useEffect(() => {
    try {
      setChoice((localStorage.getItem(KEY) as ThemeChoice) ?? 'system');
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Following the system means following it live, not only at load.
  useEffect(() => {
    if (choice !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => apply('system');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [choice]);

  const Icon = choice === 'dark' ? Moon : choice === 'light' ? Sun : Display;

  return (
    <Dropdown>
      <Tooltip delay={400}>
        <Tooltip.Trigger>
          <Dropdown.Trigger
            className={triggerClass({ isIconOnly: compact, size: 'sm', variant: 'ghost' })}
            aria-label="Theme"
          >
            <Icon />
            {!compact && <span className="capitalize">{choice}</span>}
          </Dropdown.Trigger>
        </Tooltip.Trigger>
        <Tooltip.Content>Theme</Tooltip.Content>
      </Tooltip>
      <Dropdown.Popover placement="top start">
        <Dropdown.Menu
          aria-label="Theme"
          selectionMode="single"
          selectedKeys={new Set([choice])}
          onAction={(key) => {
            const next = key as ThemeChoice;
            setChoice(next);
            try {
              localStorage.setItem(KEY, next);
            } catch {
              /* storage unavailable — applies for this page only */
            }
            apply(next);
          }}
        >
          <Dropdown.Item id="light" textValue="Light">
            <Sun />
            <Label>Light</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Dropdown.Item id="dark" textValue="Dark">
            <Moon />
            <Label>Dark</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
          <Dropdown.Item id="system" textValue="System">
            <Display />
            <Label>System</Label>
            <Dropdown.ItemIndicator />
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

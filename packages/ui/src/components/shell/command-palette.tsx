'use client';

import { ArrowUpRightFromSquare } from '@gravity-ui/icons';
import { Description, Header, Label, ListBox, Modal, SearchField } from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { canUse, type CurrentUser } from '../../lib/access';
import { NAV } from './nav-items';

/**
 * ⌘K: jump to a page, or straight to an execution or workflow by name or id.
 *
 * The id case matters more than it looks. An execution id is what arrives in a
 * log line, an alert or a support ticket, and pasting it here should land on the
 * execution rather than on a search page that then needs it pasted again.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function CommandPalette({
  isOpen,
  onOpenChange,
  user,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  user: CurrentUser;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');

  const pages = useMemo(
    () =>
      NAV.flatMap((group) =>
        group.items
          .filter((item) => canUse(user, item.scope, item.grant))
          .map((item) => ({ ...item, id: item.href, group: group.label }))
      ),
    [user]
  );

  const needle = query.trim();
  const matches = pages.filter((page) =>
    `${page.group} ${page.label}`.toLowerCase().includes(needle.toLowerCase())
  );

  const go = (href: string) => {
    onOpenChange(false);
    setQuery('');
    router.push(href);
  };

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="top">
        <Modal.Dialog className="sm:max-w-xl">
          <Modal.Body className="p-3">
            <SearchField
              aria-label="Search"
              autoFocus
              value={query}
              onChange={setQuery}
              onSubmit={() => {
                if (UUID.test(needle)) go(`/execution/${needle}`);
                else if (matches[0]) go(matches[0].href);
              }}
            >
              <SearchField.Group>
                <SearchField.SearchIcon />
                <SearchField.Input placeholder="Go to a page, execution id or workflow name" />
                <SearchField.ClearButton />
              </SearchField.Group>
            </SearchField>

            <ListBox
              aria-label="Results"
              className="mt-2 max-h-96 overflow-y-auto"
              selectionMode="none"
              onAction={(key) => go(String(key))}
            >
              {needle !== '' ? (
                <ListBox.Section>
                  <Header>Jump to</Header>
                  {UUID.test(needle) ? (
                    <ListBox.Item id={`/execution/${needle}`} textValue="Open execution">
                      <ArrowUpRightFromSquare />
                      <Label>Open execution</Label>
                      <Description className="font-mono">{needle}</Description>
                    </ListBox.Item>
                  ) : (
                    <>
                      <ListBox.Item id={`/workflowDef/${encodeURIComponent(needle)}`} textValue="Open workflow definition">
                        <ArrowUpRightFromSquare />
                        <Label>Open workflow definition</Label>
                        <Description className="font-mono">{needle}</Description>
                      </ListBox.Item>
                      <ListBox.Item
                        id={`/executions?workflowType=${encodeURIComponent(needle)}`}
                        textValue="Search executions"
                      >
                        <ArrowUpRightFromSquare />
                        <Label>Search executions of</Label>
                        <Description className="font-mono">{needle}</Description>
                      </ListBox.Item>
                    </>
                  )}
                </ListBox.Section>
              ) : null}

              <ListBox.Section>
                <Header>Pages</Header>
                {matches.map((page) => (
                  <ListBox.Item key={page.id} id={page.href} textValue={`${page.group} ${page.label}`}>
                    <Label>{page.label}</Label>
                    <Description>{page.group}</Description>
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            </ListBox>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

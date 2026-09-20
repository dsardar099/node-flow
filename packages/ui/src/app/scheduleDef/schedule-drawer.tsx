'use client';

import {
  Button,
  Chip,
  ComboBox,
  Description,
  Disclosure,
  Drawer,
  FieldError,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Spinner,
  Switch,
  TextArea,
  TextField,
  toast,
} from '@heroui/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { LocalTime } from '../../components/ui/local-time';
import { mutate } from '../../lib/mutate';
import type { Schedule } from './schedule-list';

/** Common timetables, one click away — the expression is shown, not hidden. */
const PRESETS = [
  { label: 'Every 5 minutes', cron: '0 */5 * * * *' },
  { label: 'Hourly', cron: '0 0 * * * *' },
  { label: 'Daily at 09:00', cron: '0 0 9 * * *' },
  { label: 'Weekdays at 09:00', cron: '0 0 9 * * 1-5' },
  { label: 'Mondays at 08:00', cron: '0 0 8 * * 1' },
  { label: 'First of the month', cron: '0 0 0 1 * *' },
];

const OVERLAP = [
  { id: 'ALLOW', label: 'Start anyway', hint: 'A new run starts even if the last one is still going.' },
  { id: 'SKIP', label: 'Skip this run', hint: 'Nothing starts while the previous run is still going.' },
];

const CATCHUP = [
  { id: 'FIRE_ONE', label: 'Run once', hint: 'After downtime, run the most recent missed occurrence only.' },
  { id: 'FIRE_ALL', label: 'Run every missed', hint: 'After downtime, run each missed occurrence (bounded).' },
  { id: 'SKIP', label: 'Skip missed', hint: 'After downtime, wait for the next occurrence.' },
];

function timezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(key: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

/**
 * Create or edit a schedule.
 *
 * The timetable is checked against the server as it is typed and answered with
 * the next five instants in the chosen timezone — "is that what I meant?" is
 * the only question anyone has about a cron expression, and a list of dates
 * answers it better than reading the expression does.
 */
export function ScheduleDrawer({
  namespace,
  workflowNames,
  schedule,
  isOpen,
  readOnly,
  onOpenChange,
}: {
  namespace: string;
  workflowNames: string[];
  schedule?: Schedule;
  isOpen: boolean;
  readOnly: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const isNew = !schedule;
  const zones = useMemo(timezones, []);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [version, setVersion] = useState<number | undefined>();
  const [cron, setCron] = useState('0 0 9 * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [input, setInput] = useState('{}');
  const [priority, setPriority] = useState(0);
  const [overlap, setOverlap] = useState('ALLOW');
  const [catchup, setCatchup] = useState('FIRE_ONE');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<{ upcoming?: string[]; error?: string; loading?: boolean }>({});
  const subMinute = (preview.upcoming ?? []).some(
    (at, i, all) => i > 0 && new Date(at).getTime() - new Date(all[i - 1]).getTime() < 60_000
  );

  useEffect(() => {
    if (!isOpen) return;
    setName(schedule?.name ?? '');
    setDescription(schedule?.description ?? '');
    setWorkflow(schedule?.workflow.name ?? '');
    setVersion(schedule?.workflow.version ?? undefined);
    setCron(schedule?.cron ?? '0 0 9 * * *');
    setTimezone(schedule?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
    setInput(JSON.stringify(schedule?.input ?? {}, null, 2));
    setPriority(schedule?.priority ?? 0);
    setOverlap(schedule?.overlapPolicy ?? 'ALLOW');
    setCatchup(schedule?.catchupPolicy ?? 'FIRE_ONE');
    setActive(!(schedule?.paused ?? false));
  }, [isOpen, schedule]);

  // Debounced so typing `*/15` does not validate `*/1` and `*/` on the way.
  useEffect(() => {
    if (!isOpen || !cron.trim()) return;
    setPreview((current) => ({ ...current, loading: true }));
    const timer = setTimeout(async () => {
      try {
        const result = await mutate<{ upcoming: string[] }>(`/v1/ns/${namespace}/schedules/preview`, {
          body: { cron: cron.trim(), timezone },
        });
        setPreview({ upcoming: result.upcoming });
      } catch (failure) {
        setPreview({ error: (failure as Error).message });
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [cron, timezone, isOpen, namespace]);

  let inputError: string | undefined;
  let parsedInput: Record<string, unknown> = {};
  try {
    const value = JSON.parse(input || '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) inputError = 'Input must be a JSON object';
    else parsedInput = value;
  } catch (failure) {
    inputError = (failure as Error).message;
  }

  const valid = name.trim() !== '' && workflow.trim() !== '' && !preview.error && !inputError;

  const save = async () => {
    setSaving(true);
    const body = {
      description: description || undefined,
      cron: cron.trim(),
      timezone,
      workflow: { name: workflow.trim(), ...(version ? { version } : {}) },
      input: parsedInput,
      priority,
      paused: !active,
      overlapPolicy: overlap,
      catchupPolicy: catchup,
    };
    try {
      if (isNew) await mutate(`/v1/ns/${namespace}/schedules`, { body: { name: name.trim(), ...body } });
      else await mutate(`/v1/ns/${namespace}/schedules/${encodeURIComponent(schedule.name)}`, { method: 'PUT', body });
      toast.success(isNew ? `Created ${name.trim()}` : `Saved ${schedule.name}`);
      onOpenChange(false);
      router.refresh();
    } catch (failure) {
      toast.danger((failure as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const zoneLabel = timezone === 'UTC' ? 'UTC' : timezone.replace(/_/g, ' ');

  return (
    <Drawer.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      {/* Width on the dialog: `Drawer.Content` is the full-screen positioning
          wrapper, and narrowing it pinned the panel to the left. */}
      <Drawer.Content placement="right">
        <Drawer.Dialog className="sm:w-[36rem]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{isNew ? 'New schedule' : schedule.name}</Drawer.Heading>
            <p className="text-sm text-muted">
              {isNew ? 'Start a workflow on a timetable.' : `${schedule.runCount} ${schedule.runCount === 1 ? 'run' : 'runs'} so far`}
            </p>
          </Drawer.Header>

          <Drawer.Body className="space-y-6">
            <fieldset disabled={readOnly} className="space-y-5">
              <TextField value={name} onChange={setName} isRequired isDisabled={!isNew || readOnly}>
                <Label>Name</Label>
                <Input placeholder="nightly-billing" className="font-mono" />
                {isNew && <Description>Unique in this namespace. Cannot be changed later.</Description>}
              </TextField>

              <TextField value={description} onChange={setDescription}>
                <Label>Description</Label>
                <Input placeholder="What this run is for" />
              </TextField>

              <div className="grid grid-cols-[1fr_8rem] gap-3">
                <ComboBox
                  allowsCustomValue
                  isRequired
                  inputValue={workflow}
                  onInputChange={setWorkflow}
                  onSelectionChange={(key) => key !== null && setWorkflow(String(key))}
                >
                  <Label>Workflow</Label>
                  <ComboBox.InputGroup>
                    <Input placeholder="Choose a workflow" />
                    <ComboBox.Trigger />
                  </ComboBox.InputGroup>
                  <ComboBox.Popover>
                    <ListBox>
                      {workflowNames.map((workflowName) => (
                        <ListBox.Item key={workflowName} id={workflowName} textValue={workflowName}>
                          {workflowName}
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      ))}
                    </ListBox>
                  </ComboBox.Popover>
                </ComboBox>
                <NumberField
                  value={version ?? Number.NaN}
                  minValue={1}
                  onChange={(next) => setVersion(Number.isNaN(next) ? undefined : next)}
                >
                  <Label>Version</Label>
                  <NumberField.Group>
                    <NumberField.Input placeholder="Latest" />
                  </NumberField.Group>
                </NumberField>
              </div>

              <div className="space-y-2">
                <TextField value={cron} onChange={setCron} isRequired isInvalid={Boolean(preview.error)}>
                  <Label>Cron expression</Label>
                  <Input className="font-mono" placeholder="0 0 9 * * 1-5" />
                  <Description>min hour day month weekday — or six fields with seconds first.</Description>
                  <FieldError>{preview.error}</FieldError>
                </TextField>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset.cron}
                      size="sm"
                      variant={cron === preset.cron ? 'primary' : 'tertiary'}
                      onPress={() => setCron(preset.cron)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>

              <ComboBox
                inputValue={timezone}
                onInputChange={setTimezone}
                onSelectionChange={(key) => key !== null && setTimezone(String(key))}
              >
                <Label>Timezone</Label>
                <ComboBox.InputGroup>
                  <Input />
                  <ComboBox.Trigger />
                </ComboBox.InputGroup>
                <ComboBox.Popover>
                  <ListBox>
                    {zones.map((zone) => (
                      <ListBox.Item key={zone} id={zone} textValue={zone}>
                        {zone}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </ComboBox.Popover>
              </ComboBox>

              <div className="rounded-2xl border border-separator bg-surface-secondary/50 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium">Next runs</p>
                  {preview.loading && <Spinner size="sm" />}
                </div>
                {preview.error ? (
                  <p className="text-sm text-danger">This expression will not be accepted.</p>
                ) : (
                  <ol className="space-y-1.5">
                    {(preview.upcoming ?? []).map((at, index) => (
                      <li key={at} className="flex items-center gap-3 text-sm">
                        <Chip size="sm" variant={index === 0 ? 'soft' : 'secondary'} color={index === 0 ? 'accent' : 'default'}>
                          {index + 1}
                        </Chip>
                        <span className="tabular">
                          {new Intl.DateTimeFormat(undefined, {
                            dateStyle: 'medium',
                            // Seconds only when the timetable fires more than once a minute —
                            // otherwise "02:26" twice in a row reads as a mistake.
                            timeStyle: subMinute ? 'medium' : 'short',
                            timeZone: zones.includes(timezone) || timezone === 'UTC' ? timezone : undefined,
                          }).format(new Date(at))}
                        </span>
                        <span className="text-xs text-muted">{zoneLabel}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <TextField value={input} onChange={setInput} isInvalid={Boolean(inputError)}>
                <Label>Workflow input</Label>
                <TextArea rows={5} spellCheck={false} className="font-mono text-xs" />
                <Description>Passed to every run. The run also receives the instant it was scheduled for.</Description>
                <FieldError>{inputError}</FieldError>
              </TextField>

              <Switch isSelected={active} onChange={setActive}>
                <Switch.Content>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Label>Active</Label>
                </Switch.Content>
                <Description>Paused schedules keep their settings and do not fire.</Description>
              </Switch>

              <Disclosure>
                <Disclosure.Heading>
                  <Button slot="trigger" variant="ghost" className="px-0">
                    Advanced
                    <Disclosure.Indicator />
                  </Button>
                </Disclosure.Heading>
                <Disclosure.Content>
                  <Disclosure.Body className="space-y-4 pt-2">
                    <PolicySelect label="If the previous run is still going" value={overlap} options={OVERLAP} onChange={setOverlap} />
                    <PolicySelect label="After downtime" value={catchup} options={CATCHUP} onChange={setCatchup} />
                    <NumberField value={priority} minValue={0} maxValue={99} onChange={(next) => setPriority(Number.isNaN(next) ? 0 : next)}>
                      <Label>Priority</Label>
                      <NumberField.Group>
                        <NumberField.DecrementButton />
                        <NumberField.Input />
                        <NumberField.IncrementButton />
                      </NumberField.Group>
                      <Description>0–99. Higher runs first when workers are busy.</Description>
                    </NumberField>
                  </Disclosure.Body>
                </Disclosure.Content>
              </Disclosure>

              {!isNew && schedule.lastRunAt && (
                <p className="text-xs text-muted">
                  Last ran <LocalTime value={schedule.lastRunAt} />. Saving recomputes the next run from now.
                </p>
              )}
            </fieldset>
          </Drawer.Body>

          <Drawer.Footer>
            <Button slot="close" variant="tertiary">
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button onPress={save} isDisabled={!valid || saving} isPending={saving}>
                {isNew ? 'Create schedule' : 'Save changes'}
              </Button>
            )}
          </Drawer.Footer>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  );
}

function PolicySelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { id: string; label: string; hint: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onChange={(next) => next !== null && onChange(String(next))}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Description>{options.find((option) => option.id === value)?.hint}</Description>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
              {option.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

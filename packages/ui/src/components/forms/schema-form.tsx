'use client';

import {
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  Switch,
  TextArea,
  TextField,
} from '@heroui/react';
import { useState } from 'react';

interface PropertySchema {
  type?: string | string[];
  title?: string;
  description?: string;
  enum?: unknown[];
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
}

export interface ObjectSchema {
  /** Field order. JSONB does not keep an object's key order, so a form needs to say it. */
  'ui:order'?: string[];
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, PropertySchema>;
  required?: string[];
}

/** Whether a declared form is something this renderer understands. */
export function isRenderableSchema(form: unknown): form is ObjectSchema {
  return (
    typeof form === 'object' &&
    form !== null &&
    typeof (form as ObjectSchema).properties === 'object' &&
    (form as ObjectSchema).properties !== null
  );
}

/** Initial values from the schema's defaults — a boolean with none starts false, not absent. */
export function defaultsFor(schema: ObjectSchema): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    if (property.default !== undefined) values[key] = property.default;
    else if (primaryType(property) === 'boolean') values[key] = false;
  }
  return values;
}

/** Keys that are required and still empty. */
export function missingRequired(schema: ObjectSchema, values: Record<string, unknown>): string[] {
  return (schema.required ?? []).filter((key) => values[key] === undefined || values[key] === '');
}

/**
 * Fields in the order a person should meet them.
 *
 * Declaration order is not available: definitions are stored as JSONB, which
 * reorders keys. So `ui:order` wins when given, then required fields, then the
 * rest alphabetically — stable, and the must-answer questions come first.
 */
export function orderedProperties(schema: ObjectSchema): [string, PropertySchema][] {
  const entries = Object.entries(schema.properties ?? {});
  const explicit = schema['ui:order'] ?? [];
  const required = new Set(schema.required ?? []);
  const rank = (key: string) => {
    const index = explicit.indexOf(key);
    return index >= 0 ? index : explicit.length + (required.has(key) ? 0 : 1);
  };
  return entries.sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

function primaryType(property: PropertySchema): string {
  const type = Array.isArray(property.type) ? property.type.find((t) => t !== 'null') : property.type;
  return type ?? 'string';
}

function humanise(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * A form rendered from a JSON Schema object — the subset a person fills in.
 *
 * Strings, numbers, booleans and enums become real inputs; anything richer
 * (objects, arrays) becomes a JSON field for that one property, rather than
 * the whole form collapsing back to raw JSON because of one nested value.
 */
export function SchemaForm({
  schema,
  values,
  onChange,
  isDisabled,
}: {
  schema: ObjectSchema;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  isDisabled?: boolean;
}) {
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const required = new Set(schema.required ?? []);

  return (
    <div className="space-y-4">
      {orderedProperties(schema).map(([key, property]) => {
        const label = property.title ?? humanise(key);
        const type = primaryType(property);
        const isRequired = required.has(key);

        if (property.enum) {
          return (
            <Select
              key={key}
              isRequired={isRequired}
              isDisabled={isDisabled}
              value={values[key] === undefined ? null : String(values[key])}
              onChange={(next) => {
                const match = property.enum?.find((option) => String(option) === String(next));
                set(key, match);
              }}
            >
              <Label>{label}</Label>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              {property.description && <Description>{property.description}</Description>}
              <Select.Popover>
                <ListBox>
                  {property.enum.map((option) => (
                    <ListBox.Item key={String(option)} id={String(option)} textValue={String(option)}>
                      {String(option)}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          );
        }

        if (type === 'boolean') {
          return (
            <Switch key={key} isDisabled={isDisabled} isSelected={Boolean(values[key])} onChange={(next) => set(key, next)}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <Label>{label}</Label>
              </Switch.Content>
              {property.description && <Description>{property.description}</Description>}
            </Switch>
          );
        }

        if (type === 'number' || type === 'integer') {
          return (
            <NumberField
              key={key}
              isRequired={isRequired}
              isDisabled={isDisabled}
              minValue={property.minimum}
              maxValue={property.maximum}
              step={type === 'integer' ? 1 : undefined}
              value={typeof values[key] === 'number' ? (values[key] as number) : Number.NaN}
              onChange={(next) => set(key, Number.isNaN(next) ? undefined : next)}
            >
              <Label>{label}</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input />
                <NumberField.IncrementButton />
              </NumberField.Group>
              {property.description && <Description>{property.description}</Description>}
            </NumberField>
          );
        }

        if (type === 'object' || type === 'array') {
          return <JsonProperty key={key} label={label} property={property} value={values[key]} onChange={(next) => set(key, next)} isDisabled={isDisabled} />;
        }

        const long = (property.maxLength ?? 0) > 200 || property.format === 'textarea';
        return (
          <TextField
            key={key}
            isRequired={isRequired}
            isDisabled={isDisabled}
            value={typeof values[key] === 'string' ? (values[key] as string) : ''}
            onChange={(next) => set(key, next)}
            type={property.format === 'email' ? 'email' : property.format === 'date' ? 'date' : undefined}
          >
            <Label>{label}</Label>
            {long ? <TextArea rows={4} /> : <Input />}
            {property.description && <Description>{property.description}</Description>}
          </TextField>
        );
      })}
    </div>
  );
}

function JsonProperty({
  label,
  property,
  value,
  onChange,
  isDisabled,
}: {
  label: string;
  property: PropertySchema;
  value: unknown;
  onChange: (value: unknown) => void;
  isDisabled?: boolean;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? (primaryType(property) === 'array' ? [] : {}), null, 2));
  const [error, setError] = useState<string>();
  return (
    <TextField
      value={text}
      isDisabled={isDisabled}
      isInvalid={Boolean(error)}
      onChange={(next) => {
        setText(next);
        try {
          onChange(JSON.parse(next));
          setError(undefined);
        } catch {
          setError('Not valid JSON yet');
        }
      }}
    >
      <Label>{label}</Label>
      <TextArea rows={4} spellCheck={false} className="font-mono text-xs" />
      {property.description && !error && <Description>{property.description}</Description>}
      <FieldError>{error}</FieldError>
    </TextField>
  );
}

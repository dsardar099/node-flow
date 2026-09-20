import { InvalidArgumentError } from '@node-flow-dev/core';

/**
 * Reading the operations out of an OpenAPI document.
 *
 * What this is for: an author picking `service: "billing", path: "/invoices"`
 * has no way to know what the service offers, so the editor shows them. It is
 * *discovery*, never enforcement — the document is a description the remote
 * service publishes about itself, and treating it as a contract would mean a
 * stale spec silently blocks calls that work.
 *
 * Deliberately a small reader rather than a full OpenAPI parser. Everything
 * needed to describe a call is at the top level of the document; `$ref`
 * resolution, discriminators, polymorphism and the rest belong to a validator,
 * which this is not. A library for that would be several hundred kilobytes to
 * populate a dropdown.
 */

export interface RemoteOperation {
  /** The document's own `operationId` where it has one, else `METHOD /path`. */
  id: string;
  method: string;
  path: string;
  summary?: string;
  description?: string;
  tags: string[];
  deprecated: boolean;
  parameters: { name: string; in: 'path' | 'query' | 'header' | 'cookie'; required: boolean; description?: string }[];
  /** Whether the operation takes a request body, and what it expects. */
  requestBody?: { required: boolean; mediaTypes: string[] };
}

export interface RemoteService {
  title?: string;
  version?: string;
  /** The server the document names, which may differ from the configured base URL. */
  documentBaseUrl?: string;
  operations: RemoteOperation[];
}

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const PARAMETER_LOCATIONS = new Set(['path', 'query', 'header', 'cookie']);

export function readOpenApi(document: unknown): RemoteService {
  if (!isRecord(document)) throw new InvalidArgumentError('the OpenAPI document is not a JSON object');

  const paths = document['paths'];
  if (!isRecord(paths)) {
    // Swagger 2.0 and OpenAPI 3.x both have `paths`; a document without one is
    // either not a spec at all or an error page the fetch followed.
    throw new InvalidArgumentError('the document has no "paths", so it is not an OpenAPI description');
  }

  const info = isRecord(document['info']) ? document['info'] : {};
  const operations: RemoteOperation[] = [];

  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item)) continue;
    // Parameters declared on the path apply to every operation under it, and
    // omitting them is how a path parameter goes missing from the UI.
    const shared = readParameters(item['parameters']);

    for (const method of METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) continue;

      const parameters = [...shared, ...readParameters(operation['parameters'])];
      const seen = new Set<string>();

      operations.push({
        id: typeof operation['operationId'] === 'string' ? operation['operationId'] : `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase(),
        path,
        ...(typeof operation['summary'] === 'string' ? { summary: operation['summary'] } : {}),
        ...(typeof operation['description'] === 'string' ? { description: operation['description'] } : {}),
        tags: Array.isArray(operation['tags']) ? operation['tags'].filter((tag): tag is string => typeof tag === 'string') : [],
        deprecated: operation['deprecated'] === true,
        // An operation-level parameter overrides the path-level one of the same
        // name and location, which is what the specification says.
        parameters: parameters
          .reverse()
          .filter((parameter) => {
            const key = `${parameter.in}:${parameter.name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .reverse(),
        ...readRequestBody(operation),
      });
    }
  }

  operations.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  return {
    ...(typeof info['title'] === 'string' ? { title: info['title'] } : {}),
    ...(typeof info['version'] === 'string' ? { version: info['version'] } : {}),
    ...(documentBaseUrl(document) ? { documentBaseUrl: documentBaseUrl(document) } : {}),
    operations,
  };
}

/**
 * Fills a path template from named values.
 *
 * `/orders/{id}` plus `{ id: "A-1" }` becomes `/orders/A-1`, with each value
 * percent-encoded — a path parameter containing a slash would otherwise change
 * which endpoint is called, which is a path-traversal bug wearing a template.
 * A missing parameter is an error rather than an empty segment: `/orders//items`
 * usually returns a confusing 404 far from the cause.
 */
export function fillPath(template: string, values: Record<string, unknown>): string {
  return template.replace(/\{([^}/]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null || value === '') {
      throw new InvalidArgumentError(`path parameter "${name}" has no value`);
    }
    return encodeURIComponent(String(value));
  });
}

function readParameters(raw: unknown): RemoteOperation['parameters'] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = entry['name'];
    const location = entry['in'];
    if (typeof name !== 'string' || typeof location !== 'string' || !PARAMETER_LOCATIONS.has(location)) return [];
    return [
      {
        name,
        in: location as RemoteOperation['parameters'][number]['in'],
        // A path parameter is required by definition, whatever the document says.
        required: entry['required'] === true || location === 'path',
        ...(typeof entry['description'] === 'string' ? { description: entry['description'] } : {}),
      },
    ];
  });
}

function readRequestBody(operation: Record<string, unknown>): Pick<RemoteOperation, 'requestBody'> {
  const body = operation['requestBody'];
  if (isRecord(body)) {
    const content = isRecord(body['content']) ? Object.keys(body['content']) : [];
    return { requestBody: { required: body['required'] === true, mediaTypes: content } };
  }

  // Swagger 2.0 spells the body as a parameter, and node-flow reads both
  // because plenty of internal services never moved off it.
  const parameters = operation['parameters'];
  if (Array.isArray(parameters) && parameters.some((entry) => isRecord(entry) && entry['in'] === 'body')) {
    const required = parameters.some((entry) => isRecord(entry) && entry['in'] === 'body' && entry['required'] === true);
    const consumes = Array.isArray(operation['consumes'])
      ? operation['consumes'].filter((type): type is string => typeof type === 'string')
      : ['application/json'];
    return { requestBody: { required, mediaTypes: consumes } };
  }

  return {};
}

/** The first server URL a document names, across OpenAPI 3 and Swagger 2 spellings. */
function documentBaseUrl(document: Record<string, unknown>): string | undefined {
  const servers = document['servers'];
  if (Array.isArray(servers) && isRecord(servers[0]) && typeof servers[0]['url'] === 'string') {
    return servers[0]['url'];
  }

  const host = document['host'];
  if (typeof host === 'string' && host !== '') {
    const schemes = Array.isArray(document['schemes']) ? document['schemes'] : ['https'];
    const scheme = typeof schemes[0] === 'string' ? schemes[0] : 'https';
    const basePath = typeof document['basePath'] === 'string' ? document['basePath'] : '';
    return `${scheme}://${host}${basePath}`;
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { describe, expect, it } from 'vitest';
import { fillPath, readOpenApi } from './openapi-operations.js';

/**
 * Reading a service's own description of itself.
 *
 * The documents in the wild are messier than the specification suggests —
 * Swagger 2.0 next to OpenAPI 3.1, parameters declared on the path rather than
 * the operation, bodies spelled two different ways — so the tests are mostly
 * about not losing operations to those differences. A missing operation is a
 * dropdown that silently omits the endpoint someone needs.
 */

const petstore = {
  openapi: '3.1.0',
  info: { title: 'Billing', version: '2.4.0' },
  servers: [{ url: 'https://api.example.com/v2' }],
  paths: {
    '/invoices/{id}': {
      // Declared once for every operation under this path.
      parameters: [{ name: 'id', in: 'path', description: 'Invoice id' }],
      get: { operationId: 'getInvoice', summary: 'Fetch one invoice', tags: ['invoices'] },
      delete: { operationId: 'voidInvoice', deprecated: true },
    },
    '/invoices': {
      post: {
        operationId: 'createInvoice',
        parameters: [{ name: 'dryRun', in: 'query', required: false }],
        requestBody: { required: true, content: { 'application/json': {} } },
      },
      get: { parameters: [{ name: 'status', in: 'query' }] },
    },
  },
};

describe('reading an OpenAPI document', () => {
  it('lists every operation with the parameters it actually takes', () => {
    const service = readOpenApi(petstore);

    expect(service).toMatchObject({ title: 'Billing', version: '2.4.0', documentBaseUrl: 'https://api.example.com/v2' });
    expect(service.operations.map((o) => `${o.method} ${o.path}`)).toEqual([
      'GET /invoices',
      'POST /invoices',
      'DELETE /invoices/{id}',
      'GET /invoices/{id}',
    ]);

    const get = service.operations.find((o) => o.id === 'getInvoice');
    // The parameter lives on the path, not the operation; missing it is how a
    // path parameter disappears from the editor.
    expect(get?.parameters).toEqual([{ name: 'id', in: 'path', required: true, description: 'Invoice id' }]);
    expect(get?.summary).toBe('Fetch one invoice');
    expect(get?.tags).toEqual(['invoices']);

    const create = service.operations.find((o) => o.id === 'createInvoice');
    expect(create?.parameters).toEqual([{ name: 'dryRun', in: 'query', required: false }]);
    expect(create?.requestBody).toEqual({ required: true, mediaTypes: ['application/json'] });

    // No operationId: the method and path are the name, which is what an
    // author sees in the list.
    expect(service.operations.find((o) => o.id === 'GET /invoices')).toBeDefined();
    expect(service.operations.find((o) => o.id === 'voidInvoice')?.deprecated).toBe(true);
  });

  it('reads Swagger 2.0, including a body declared as a parameter', () => {
    const service = readOpenApi({
      swagger: '2.0',
      host: 'legacy.example.com',
      basePath: '/api',
      schemes: ['https'],
      paths: {
        '/orders': {
          post: {
            operationId: 'placeOrder',
            consumes: ['application/xml'],
            parameters: [
              { name: 'order', in: 'body', required: true },
              { name: 'x-trace', in: 'header' },
            ],
          },
        },
      },
    });

    expect(service.documentBaseUrl).toBe('https://legacy.example.com/api');
    const order = service.operations[0];
    expect(order.requestBody).toEqual({ required: true, mediaTypes: ['application/xml'] });
    // The body parameter is not a callable parameter; the header is.
    expect(order.parameters).toEqual([{ name: 'x-trace', in: 'header', required: false }]);
  });

  it('lets an operation override a parameter the path declared', () => {
    const service = readOpenApi({
      openapi: '3.1.0',
      paths: {
        '/things/{id}': {
          parameters: [{ name: 'verbose', in: 'query', required: false, description: 'from the path' }],
          get: { parameters: [{ name: 'verbose', in: 'query', required: true, description: 'from the operation' }] },
        },
      },
    });

    expect(service.operations[0].parameters).toEqual([
      { name: 'verbose', in: 'query', required: true, description: 'from the operation' },
    ]);
  });

  it('refuses something that is not a description at all', () => {
    expect(() => readOpenApi('<html>404</html>')).toThrow(/not a JSON object/);
    expect(() => readOpenApi({ info: { title: 'x' } })).toThrow(/no "paths"/);
    // An empty but valid document is not an error: a service may publish one.
    expect(readOpenApi({ openapi: '3.1.0', paths: {} }).operations).toEqual([]);
  });
});

describe('filling a path template', () => {
  it('substitutes and encodes each value', () => {
    expect(fillPath('/orders/{id}/items/{sku}', { id: 'A 1', sku: 'x/y' })).toBe('/orders/A%201/items/x%2Fy');
  });

  // A slash that survived encoding would change which endpoint is called —
  // path traversal wearing a template.
  it('refuses to leave a parameter empty', () => {
    expect(() => fillPath('/orders/{id}', {})).toThrow(/path parameter "id" has no value/);
    expect(() => fillPath('/orders/{id}', { id: '' })).toThrow(/has no value/);
  });

  it('leaves a template with no parameters alone', () => {
    expect(fillPath('/health', { unused: 1 })).toBe('/health');
  });
});

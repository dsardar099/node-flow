// The OpenAPI document is an intentionally shared, generated repository artefact.
// eslint-disable-next-line @nx/enforce-module-boundaries
import openapi from '../../../../../../clients/openapi.json';

/** Canonical document consumed by Scalar and available to SDK/tooling users. */
export function GET() {
  return Response.json(openapi, {
    headers: {
      'Cache-Control': 'public, max-age=0, must-revalidate',
      'Content-Disposition': 'inline; filename="node-flow-openapi.json"',
    },
  });
}

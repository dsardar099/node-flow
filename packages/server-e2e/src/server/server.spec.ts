import axios from 'axios';

describe('GET /v1', () => {
  it('should return a message', async () => {
    const res = await axios.get(`/v1`);

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ message: 'Hello API' });
  });

  // The adapter swap from Express to Fastify is invisible to controllers by
  // design, so assert it at the wire level instead: Fastify advertises
  // keep-alive timeouts on every response and Express does not. If this header
  // disappears, something has quietly put Express back in the request path.
  it('is served by the Fastify adapter', async () => {
    const res = await axios.get(`/v1`);

    expect(res.headers['keep-alive']).toMatch(/timeout=\d+/);
  });
});

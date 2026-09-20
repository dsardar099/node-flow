import { Injectable, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { QueueNotifier } from '@node-flow-dev/store';

/**
 * Makes shutdown prompt instead of waiting out every open connection.
 *
 * Two things hold an HTTP server open at close time, and both need dealing with
 * explicitly:
 *
 *  1. **Parked long-polls.** A poll waiting for work is an in-flight request as
 *     far as the server is concerned, so `close()` waits for it — for the whole
 *     poll duration, since not returning early is the entire point. A worker
 *     aborting its side does not help: the client socket closes, the handler
 *     keeps waiting.
 *  2. **Idle keep-alive sockets.** A worker fleet holds one per connection, and
 *     `connectionTimeout: 0` — required so a long-poll is not cut off mid-wait
 *     — means they never expire on their own.
 *
 * Fastify's `forceCloseConnections: 'idle'` looks like the answer and is not:
 * it only takes effect when a custom `serverFactory` is supplied, which Nest's
 * adapter does not do, so setting it is silently a no-op. `true` would work but
 * destroys in-flight requests indiscriminately. Calling
 * `closeIdleConnections()` directly gives the intended behaviour — drop idle
 * sockets, let real work finish.
 *
 * Runs in `beforeApplicationShutdown` because Nest closes the HTTP server
 * between that hook and `onApplicationShutdown`; doing it later is too late.
 */
@Injectable()
export class HttpShutdownService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(HttpShutdownService.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly notifier: QueueNotifier
  ) {}

  beforeApplicationShutdown(): void {
    // Order matters: released polls write their responses and their sockets
    // become idle, so they are then eligible for the sweep below.
    this.notifier.releaseAll();

    const server = this.adapterHost.httpAdapter?.getHttpServer() as
      | { closeIdleConnections?: () => void }
      | undefined;

    if (typeof server?.closeIdleConnections !== 'function') return;

    // Twice, a tick apart. The first sweep runs before the just-released polls
    // have finished writing, so their sockets are not yet idle; the second
    // catches them. Cheap, and the alternative is waiting for a keep-alive
    // socket that has no timeout.
    server.closeIdleConnections();
    setImmediate(() => {
      try {
        server.closeIdleConnections?.();
      } catch (error) {
        this.logger.warn(`could not close idle connections: ${String(error)}`);
      }
    });
  }
}

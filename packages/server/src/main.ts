import { startTelemetry, stopTelemetry } from './telemetry.js';

/**
 * Server entrypoint.
 *
 * Fastify rather than Express: worker queue-polling is the highest-volume
 * endpoint in the system by a wide margin, and adapter throughput shows up
 * directly in how many workers one server can hold.
 *
 * Keep this application HTTP-adapter-agnostic beyond this file — no
 * `@Res() res: Response`, no Express- or Fastify-shaped middleware in
 * controllers. That is what kept swapping the adapter a few lines rather than a
 * refactor, and it is worth preserving.
 *
 * Everything configurable lives in `configureApp`, shared with the integration
 * tests so they exercise the application that actually ships.
 *
 * ## Why the imports below are dynamic
 *
 * OpenTelemetry instruments modules by patching them as they load, so it has to
 * start before Nest, Fastify and `pg` are ever imported. ES module imports are
 * **hoisted** — every static `import` in a file runs before its first
 * statement, wherever it appears in the source — so `startTelemetry()` sitting
 * above a list of static imports would run *after* the modules it is meant to
 * patch and trace nothing, which looks exactly like tracing being switched off.
 * Importing dynamically, after the SDK has started, is what actually gives the
 * ordering this comment claims.
 */
type NestFastifyApplication = import('@nestjs/platform-fastify').NestFastifyApplication;

async function bootstrap() {
  startTelemetry();

  // Imported here, after the SDK has started, rather than at the top of the
  // file. The bundle is CommonJS, so this is an ordinary lazy `require` — which
  // is exactly what is wanted: the modules OpenTelemetry patches must not have
  // been loaded before it was ready to patch them.
  const { Logger } = await import('@nestjs/common');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./app/app.module.js');
  const { configureApp, createAdapter } = await import('./app/configure-app.js');

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, createAdapter());

  await configureApp(app);

  const port = Number(process.env.PORT ?? 3000);

  // Bind 0.0.0.0, not Fastify's default localhost: inside a container the
  // default makes the server unreachable from outside, which presents as a
  // silent "connection refused" with a perfectly healthy-looking process.
  await app.listen(port, '0.0.0.0');

  Logger.log(`node-flow server listening on http://localhost:${port}/v1`, 'Bootstrap');

  // Flushes the last spans rather than losing them with the process — during an
  // incident those are the ones someone is waiting to see.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void stopTelemetry());
  }
}

bootstrap();

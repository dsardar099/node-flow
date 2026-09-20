import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { loadConfig, type AppConfig } from './config.schema.js';

/**
 * Configuration, validated once and injected as a plain typed object.
 *
 * `@nestjs/config`'s own `ConfigService.get()` returns `any` unless every call
 * site restates the type, which defeats the point of validating at all. So the
 * validated object is provided directly under {@link APP_CONFIG}: one shape,
 * fully typed, impossible to read a key that does not exist.
 *
 * Global because nearly every module needs at least one setting, and threading
 * imports for it adds noise without adding safety.
 */

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, cache: true })],
  providers: [
    {
      provide: APP_CONFIG,
      // Reads `process.env` rather than `ConfigService` deliberately: this must
      // run before anything else can ask for a setting, and it must fail the
      // whole boot rather than return a partially valid object.
      useFactory: (): AppConfig => loadConfig(process.env),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

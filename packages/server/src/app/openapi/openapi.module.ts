import { Controller, Get, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { Public } from '../auth/auth.decorators.js';
import { OpenApiService } from './openapi.service.js';

/**
 * Serves the OpenAPI 3.1 document.
 *
 * Public, deliberately. The document describes the shape of the API, not its
 * contents — every endpoint in it still requires credentials, and each carries
 * the scopes it needs. Gating the description behind authentication mostly
 * obstructs the person trying to work out how to authenticate.
 *
 * No Swagger UI. Serving it would pull `@fastify/static` back in, which was
 * excluded on the grounds that this is a JSON API with a separate dashboard.
 * The document itself is the contract; any viewer can point at this URL.
 */
@Controller('openapi.json')
export class OpenApiController {
  constructor(private readonly openapi: OpenApiService) {}

  @Public()
  @Get()
  document() {
    return this.openapi.document();
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [OpenApiController],
  providers: [OpenApiService],
  exports: [OpenApiService],
})
export class OpenApiModule {}

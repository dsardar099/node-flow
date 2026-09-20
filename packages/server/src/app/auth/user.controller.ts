import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { PrincipalType, Scope, isValidScope, type Principal } from '@node-flow-dev/core';
import { UserRepository } from '@node-flow-dev/store';
import { z } from 'zod';
import { NamespaceResolver } from '../common/namespace.resolver.js';
import { zodBody } from '../common/zod.pipe.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';
import { CurrentPrincipal, Public, RequireScopes } from './auth.decorators.js';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  csrfCookie,
  newCsrfToken,
  readCookie,
  sessionCookie,
} from './session.js';
import { Audited } from '../common/audit.interceptor.js';

/**
 * Human login.
 *
 * Separate from `AuthController`, which issues machine credentials, because
 * almost nothing is shared: this path sets cookies, enforces a password policy
 * and has to resist brute force and user enumeration. Folding them together
 * would mean one of the two got the wrong defaults.
 */

const loginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

const createUserSchema = z.object({
  email: z.string().email().max(320),
  name: z.string().min(1).max(255),
  password: z.string().min(1).max(200),
  scopes: z
    .array(z.string().refine(isValidScope, 'not a valid scope'))
    .max(64)
    .default([]),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

/** Minimal shapes, so the controller stays adapter-agnostic. */
interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}
interface ReplyLike {
  header(name: string, value: string): unknown;
}

@Controller('ns/:ns/users')
export class UserController {
  constructor(
    private readonly users: UserRepository,
    private readonly namespaces: NamespaceResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  /**
   * Logs in and sets the session cookie.
   *
   * Two cookies come back: the `HttpOnly` session, which script cannot read, and
   * a readable CSRF token the page echoes in a header. See `session.ts` for why
   * both are needed.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiRoute({
    summary: 'Log in with email and password',
    description:
      'Sets an HttpOnly session cookie and a readable CSRF cookie. Echo the ' +
      'CSRF value in the X-CSRF-Token header on every subsequent mutating request.',
    tags: ['auth'],
    body: loginSchema,
  })
  async login(
    @Param('ns') _namespace: string,
    @Body(zodBody(loginSchema)) body: z.infer<typeof loginSchema>,
    @Req() request: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike
  ) {
    const namespaceId = await this.namespaceOf(_namespace);

    const first = (value: string | string[] | undefined) =>
      Array.isArray(value) ? value[0] : value;

    const result = await this.users.login({
      namespaceId,
      email: body.email,
      password: body.password,
      userAgent: first(request.headers['user-agent']),
      ipAddress: request.ip,
    });

    if (!result.ok) {
      // A lockout is reported as 429 with `Retry-After` rather than 401,
      // because it is genuinely a different situation: the credentials may well
      // be right, and a client that retries immediately makes it worse.
      if (result.reason === 'locked') {
        // `Retry-After` is the half of a 429 that a client can act on. Without
        // it, a well-behaved client has no idea whether to wait a second or an
        // hour, so it retries immediately and extends its own lockout.
        reply.header('retry-after', String(result.retryAfterSeconds));

        throw new HttpException(
          {
            error: 'too_many_attempts',
            message: 'too many failed attempts; try again shortly',
            retryAfterSeconds: result.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS
        );
      }

      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'incorrect email or password',
      });
    }

    const secure = this.config.NODE_ENV === 'production';
    const maxAgeSeconds = Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000);
    const csrf = newCsrfToken();

    reply.header('set-cookie', [
      sessionCookie(result.session.token, { secure, maxAgeSeconds }),
      csrfCookie(csrf, { secure, maxAgeSeconds }),
    ] as unknown as string);

    return {
      user: {
        id: result.principal.id,
        name: result.principal.name,
        namespaceId: result.principal.namespaceId,
        scopes: result.principal.scopes,
      },
      csrfToken: csrf,
      expiresAt: result.session.expiresAt,
    };
  }

  /**
   * Logs out.
   *
   * Revokes the row *and* clears the cookies. Clearing only the cookie would
   * leave a working session behind for anyone who captured the value.
   */
  @Post('logout')
  @HttpCode(204)
  @ApiRoute({ summary: 'End the current session', tags: ['auth'] })
  async logout(
    @Req() request: RequestLike,
    @Res({ passthrough: true }) reply: ReplyLike
  ): Promise<void> {
    const cookies = Array.isArray(request.headers['cookie'])
      ? request.headers['cookie'][0]
      : request.headers['cookie'];

    const token = readCookie(cookies, SESSION_COOKIE);
    if (token) await this.users.revokeSession(token);

    const secure = this.config.NODE_ENV === 'production';
    reply.header('set-cookie', [
      clearCookie(SESSION_COOKIE, secure),
      clearCookie(CSRF_COOKIE, secure),
    ] as unknown as string);
  }

  /** Ends every session for the caller — "sign out everywhere". */
  @Post('logout-all')
  @HttpCode(200)
  @ApiRoute({ summary: 'End every session for the current user', tags: ['auth'] })
  async logoutEverywhere(@CurrentPrincipal() principal: Principal) {
    this.assertHuman(principal);
    return { revoked: await this.users.revokeAllSessions(principal.id) };
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiRoute({
    summary: 'Change your own password',
    description: 'Ends every other session, which is the point of changing it after a compromise.',
    tags: ['auth'],
    body: changePasswordSchema,
  })
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>
  ): Promise<void> {
    this.assertHuman(principal);

    const changed = await this.users.changePassword(
      principal.id,
      body.currentPassword,
      body.newPassword
    );

    if (!changed) {
      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'current password is incorrect',
      });
    }
  }

  // ------------------------------------------------------------ administration

  @Audited('user', 'create')
  @Post()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({
    summary: 'Create a user',
    description: 'The password must satisfy the policy; see the error detail for what failed.',
    tags: ['auth'],
    body: createUserSchema,
  })
  async createUser(
    @CurrentPrincipal() principal: Principal,
    @Body(zodBody(createUserSchema)) body: z.infer<typeof createUserSchema>
  ) {
    const created = await this.users.createUser({
      // From the credential, never the body.
      namespaceId: principal.namespaceId,
      email: body.email,
      name: body.name,
      password: body.password,
      scopes: body.scopes,
    });

    return { id: created.id, email: body.email.toLowerCase() };
  }

  @Get()
  @RequireScopes(Scope.ADMIN)
  @ApiRoute({ summary: 'List users', tags: ['auth'] })
  listUsers(@CurrentPrincipal() principal: Principal) {
    return this.users.listUsers(principal.namespaceId);
  }

  @Audited('user', 'disable')
  @Delete(':id')
  @RequireScopes(Scope.ADMIN)
  @HttpCode(204)
  @ApiRoute({
    summary: 'Disable a user',
    description: 'Also revokes their sessions — otherwise they stay logged in until expiry.',
    tags: ['auth'],
  })
  async disableUser(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string
  ): Promise<void> {
    await this.users.disableUser(principal.namespaceId, id);
  }

  /**
   * These endpoints act on "the current user", which a machine credential does
   * not have. Rejecting explicitly beats using `principal.id` and quietly
   * operating on a service account row that does not exist in `Users`.
   */
  private assertHuman(principal: Principal): void {
    if (principal.type !== PrincipalType.USER) {
      throw new UnauthorizedException({
        error: 'not_a_user_session',
        message: 'this endpoint requires a logged-in user, not a machine credential',
      });
    }
  }

  private async namespaceOf(slug: string): Promise<string> {
    const id = await this.namespaces.idFor(slug);
    if (!id) {
      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'incorrect email or password',
      });
    }
    return id;
  }
}

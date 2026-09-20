import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ErrorCode } from '@node-flow-dev/core';
import { UserRepository } from '@node-flow-dev/store';
import { Public } from '../auth/auth.decorators.js';
import {
  clearCookie,
  csrfCookie,
  newCsrfToken,
  readCookie,
  sessionCookie,
} from '../auth/session.js';
import { SamlService } from '../auth/saml.service.js';
import { SsoService, safeReturnTo } from '../auth/sso.service.js';
import { NamespaceResolver } from '../common/namespace.resolver.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.schema.js';
import { ApiRoute } from '../openapi/api-route.decorator.js';

/**
 * Single sign-on for humans.
 *
 * Both routes are `@Public()` by necessity — they are what a person uses when
 * they have no session yet — and both are `GET`, because a browser redirect
 * cannot be anything else. That makes the `state` check the only thing standing
 * between this callback and login CSRF, which is why it is the first thing done
 * and why the flow cookie is signed.
 */

/** The flow state, carried across the redirect to the IdP and back. */
const FLOW_COOKIE = 'nf_sso';
const SAML_FLOW_COOKIE = 'nf_saml';

interface ReplyLike {
  header(name: string, value: string): unknown;
  status(code: number): unknown;
  redirect(url: string, code?: number): unknown;
}

@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly saml: SamlService,
    private readonly users: UserRepository,
    private readonly namespaces: NamespaceResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Public()
  @Get('providers')
  @ApiRoute({
    summary: 'List the identity providers configured for sign-in',
    description:
      'What a login page renders its buttons from, OIDC and SAML together — ' +
      'each says which protocol it speaks, because that decides which URL the ' +
      'button points at. Public by necessity.',
    tags: ['auth'],
  })
  providers() {
    return {
      providers: [
        ...this.sso.list().map((provider) => ({ ...provider, protocol: 'oidc' as const })),
        ...this.saml.list(),
      ],
    };
  }

  @Public()
  @Get(':provider/login')
  @ApiRoute({
    summary: 'Begin a single sign-on login',
    description:
      'Redirects to the identity provider with PKCE, a nonce and a state ' +
      'value, and remembers all three in a signed, HttpOnly cookie.',
    tags: ['auth'],
  })
  login(
    @Param('provider') name: string,
    @Res({ passthrough: true }) reply: ReplyLike,
    @Query('returnTo') returnTo?: string
  ) {
    const provider = this.sso.provider(name);
    if (!provider) throw notFound(name);

    const { url, flow } = this.sso.begin(provider, safeReturnTo(returnTo));
    const secure = this.config.NODE_ENV === 'production';

    reply.header(
      'set-cookie',
      // Short-lived: this is a login in progress, and an abandoned one should
      // not leave a usable cookie behind for the rest of the day.
      `${FLOW_COOKIE}=${encodeURIComponent(this.sso.seal(flow))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
        secure ? '; Secure' : ''
      }`
    );

    reply.redirect(url, 302);
  }

  @Public()
  @Get(':provider/callback')
  @ApiRoute({
    summary: 'Complete a single sign-on login',
    description:
      'Verifies state, exchanges the code, verifies the ID token and its ' +
      'nonce, then issues the same session a password login would.',
    tags: ['auth'],
  })
  async callback(
    @Param('provider') name: string,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Res({ passthrough: true }) reply: ReplyLike,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string
  ) {
    const provider = this.sso.provider(name);
    if (!provider) throw notFound(name);

    const secure = this.config.NODE_ENV === 'production';
    // The flow is finished either way — success, failure, or the user pressing
    // cancel at the IdP — so the cookie goes now rather than on the happy path.
    const expireFlow = () => clearCookie(FLOW_COOKIE, secure);

    if (error) {
      reply.header('set-cookie', expireFlow());
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: `the identity provider refused: ${error}`,
      });
    }

    const flow = this.sso.open(readCookie(cookieHeader, FLOW_COOKIE));

    // Checked before anything else and before the code is used. Without it, an
    // attacker completes their own login and redirects the victim here, logging
    // the victim into the attacker's account.
    if (!flow || !state || !this.sso.statesMatch(state, flow.state) || flow.provider !== name) {
      reply.header('set-cookie', expireFlow());
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: 'this login did not start here, or took too long',
      });
    }

    if (!code) {
      reply.header('set-cookie', expireFlow());
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: 'the identity provider returned no authorization code',
      });
    }

    let identity;
    try {
      identity = await this.sso.complete(provider, code, flow);
    } catch (failure) {
      reply.header('set-cookie', expireFlow());
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: `single sign-on failed: ${(failure as Error).message}`,
      });
    }

    const namespaceId = await this.namespaces.idFor(provider.namespace);
    if (!namespaceId) {
      // A misconfigured provider, not a bad login. Saying which namespace is
      // safe here: it came from this install's own configuration.
      reply.header('set-cookie', expireFlow());
      throw new BadRequestException({
        error: ErrorCode.INVALID_ARGUMENT,
        message: `provider "${name}" is configured for namespace "${provider.namespace}", which does not exist`,
      });
    }

    const result = await this.users.loginFederated({
      namespaceId,
      email: identity.email,
      name: identity.name,
      userAgent,
    });

    const maxAgeSeconds = Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000);
    const csrf = newCsrfToken();

    reply.header('set-cookie', [
      expireFlow(),
      sessionCookie(result.session.token, { secure, maxAgeSeconds }),
      csrfCookie(csrf, { secure, maxAgeSeconds }),
    ] as unknown as string);

    // Back to where the login started — a path, never a URL, so this cannot be
    // turned into an open redirect carrying a fresh session.
    reply.redirect(safeReturnTo(flow.returnTo), 302);
  }
}

function notFound(name: string): NotFoundException {
  return new NotFoundException({
    error: ErrorCode.NOT_FOUND,
    message: `no single sign-on provider "${name}"`,
  });
}

/**
 * SAML 2.0 sign-in.
 *
 * The shape differs from OIDC in one way that matters: the assertion comes
 * back as a **cross-site form POST** from the identity provider, not as a
 * redirect this site initiated. A `SameSite=Lax` cookie is not sent on one, so
 * the flow cookie is `SameSite=None` where the connection is secure enough to
 * allow it. That makes the signed `RelayState` and the `InResponseTo` check in
 * `SamlService` the whole of the CSRF defence, rather than a second layer
 * behind the cookie policy.
 */
@Controller('auth/saml')
export class SamlController {
  constructor(
    private readonly saml: SamlService,
    private readonly users: UserRepository,
    private readonly namespaces: NamespaceResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig
  ) {}

  @Public()
  @Get(':provider/metadata')
  @ApiRoute({
    summary: 'The service-provider metadata to upload to the identity provider',
    description:
      'Saves transcribing an entity id and an ACS URL by hand, which is where ' +
      'SAML setups usually go wrong.',
    tags: ['auth'],
  })
  metadata(@Param('provider') name: string, @Res({ passthrough: true }) reply: ReplyLike): string {
    const provider = this.saml.provider(name);
    if (!provider) throw notFound(name);

    reply.header('content-type', 'application/samlmetadata+xml');
    return this.saml.metadata(provider);
  }

  @Public()
  @Get(':provider/login')
  @ApiRoute({
    summary: 'Begin a SAML login',
    description:
      'Redirects to the identity provider with a freshly generated request ' +
      'id and RelayState, and remembers both in a signed, HttpOnly cookie.',
    tags: ['auth'],
  })
  async login(
    @Param('provider') name: string,
    @Res({ passthrough: true }) reply: ReplyLike,
    @Query('returnTo') returnTo?: string
  ) {
    const provider = this.saml.provider(name);
    if (!provider) throw notFound(name);

    const { url, flow } = await this.saml.begin(provider, safeReturnTo(returnTo));
    reply.header('set-cookie', this.flowCookie(this.saml.seal(flow)));
    reply.redirect(url, 302);
  }

  @Public()
  @Post(':provider/callback')
  @ApiRoute({
    summary: 'Complete a SAML login',
    description:
      'Validates the assertion, confirms it answers the request this browser ' +
      'started, then issues the same session a password login would.',
    tags: ['auth'],
  })
  async callback(
    @Param('provider') name: string,
    @Headers('cookie') cookieHeader: string | undefined,
    @Headers('user-agent') userAgent: string | undefined,
    @Body() body: Record<string, string> | undefined,
    @Res({ passthrough: true }) reply: ReplyLike
  ) {
    const provider = this.saml.provider(name);
    if (!provider) throw notFound(name);

    const secure = this.config.NODE_ENV === 'production';
    const expireFlow = () => clearCookie(SAML_FLOW_COOKIE, secure);
    const refuse = (message: string) => {
      reply.header('set-cookie', expireFlow());
      return new BadRequestException({ error: ErrorCode.INVALID_ARGUMENT, message });
    };

    const flow = this.saml.open(readCookie(cookieHeader, SAML_FLOW_COOKIE));
    const relay = body?.['RelayState'];

    // First, before the assertion is parsed at all: an assertion this browser
    // did not ask for is login CSRF, however valid its signature is.
    if (!flow || !relay || !this.saml.relayMatches(relay, flow.relay) || flow.provider !== name) {
      throw refuse('this login did not start here, or took too long');
    }

    const samlResponse = body?.['SAMLResponse'];
    if (!samlResponse) throw refuse('the identity provider posted no SAMLResponse');

    let identity;
    try {
      identity = await this.saml.complete(provider, samlResponse, flow);
    } catch (failure) {
      throw refuse(`single sign-on failed: ${(failure as Error).message}`);
    }

    const namespaceId = await this.namespaces.idFor(provider.namespace);
    if (!namespaceId) {
      throw refuse(`provider "${name}" is configured for namespace "${provider.namespace}", which does not exist`);
    }

    const result = await this.users.loginFederated({
      namespaceId,
      email: identity.email,
      name: identity.name,
      userAgent,
    });

    const maxAgeSeconds = Math.floor((result.session.expiresAt.getTime() - Date.now()) / 1000);
    const csrf = newCsrfToken();

    reply.header('set-cookie', [
      expireFlow(),
      sessionCookie(result.session.token, { secure, maxAgeSeconds }),
      csrfCookie(csrf, { secure, maxAgeSeconds }),
    ] as unknown as string);

    reply.redirect(safeReturnTo(flow.returnTo), 302);
  }

  /**
   * The flow cookie.
   *
   * `SameSite=None` is what lets the browser carry it into the IdP's
   * cross-site POST, and browsers only accept that pairing with `Secure`. Over
   * plain HTTP — development — it falls back to `Lax`, which is enough when
   * the IdP is same-site and honest about why it is not otherwise.
   */
  private flowCookie(value: string): string {
    const secure = this.config.NODE_ENV === 'production';
    const sameSite = secure ? 'None; Secure' : 'Lax';
    return `${SAML_FLOW_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=600`;
  }
}

@Module({ controllers: [SsoController, SamlController], providers: [SsoService, SamlService] })
export class SsoModule {}

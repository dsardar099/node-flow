import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { GroupRepository, IdentityRepository, UserRepository, type Db } from '@node-flow-dev/store';
import { NamespaceResolver } from '../common/namespace.resolver.js';
import { DB } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { ApiKeyAuthenticator, BearerTokenAuthenticator } from './authenticators.js';
import { MtlsAuthenticator, OidcWorkloadAuthenticator } from './workload.authenticators.js';
import { SessionAuthenticator } from './session.authenticator.js';
import { UserController } from './user.controller.js';
import { AuthenticatorChain } from './authenticator.js';
import { TokenService } from './token.service.js';

/**
 * Identity and authorization.
 *
 * The guard is registered through `APP_GUARD` rather than applied per
 * controller, which is what makes the policy default-deny: a new controller is
 * protected the moment it exists, and opting out takes an explicit `@Public()`.
 *
 * Adding mTLS or OIDC workload identity in Phase 5 means adding an
 * `Authenticator` to the chain below. Nothing else in the application changes,
 * because nothing else knows how a principal was established.
 */
@Global()
@Module({
  controllers: [AuthController, UserController],
  providers: [
    TokenService,
    NamespaceResolver,
    {
      provide: IdentityRepository,
      inject: [DB],
      useFactory: (db: Db) => new IdentityRepository(db),
    },
    {
      provide: UserRepository,
      // Groups supply the scopes a user holds beyond their own. Without this
      // injection a group grants nothing and says nothing — the silent-disable
      // shape that the webhook repository and the human-task inbox each hit.
      inject: [DB, GroupRepository],
      useFactory: (db: Db, groups: GroupRepository) => new UserRepository(db, groups),
    },
    ApiKeyAuthenticator,
    BearerTokenAuthenticator,
    SessionAuthenticator,
    OidcWorkloadAuthenticator,
    MtlsAuthenticator,
    {
      provide: AuthenticatorChain,
      inject: [
        ApiKeyAuthenticator,
        BearerTokenAuthenticator,
        SessionAuthenticator,
        OidcWorkloadAuthenticator,
        MtlsAuthenticator,
      ],
      useFactory: (
        apiKey: ApiKeyAuthenticator,
        bearer: BearerTokenAuthenticator,
        session: SessionAuthenticator,
        oidc: OidcWorkloadAuthenticator,
        mtls: MtlsAuthenticator
      ) =>
        // Order is fixed rather than incidental. Most of these read different
        // headers so at most one applies — but OIDC and the service-account
        // bearer token both read `Authorization`, and there the order matters:
        // OIDC runs first and falls through on any token it cannot verify, so
        // a service-account JWT still reaches the mechanism that issued it.
        new AuthenticatorChain([apiKey, oidc, bearer, session, mtls]),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [IdentityRepository, UserRepository, TokenService, AuthenticatorChain, NamespaceResolver],
})
export class AuthModule {}

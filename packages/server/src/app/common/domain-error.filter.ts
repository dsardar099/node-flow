import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErrorCode, NodeFlowError } from '@node-flow-dev/core';

/**
 * Maps the engine's error taxonomy onto HTTP.
 *
 * The mapping lives here, once, rather than as try/catch in each controller.
 * Two reasons: a service should be able to throw a domain error without knowing
 * it is being called over HTTP — the same code runs from the CLI and the
 * runners — and a status code chosen per call site drifts, so the same failure
 * ends up as 400 on one endpoint and 500 on another.
 *
 * Every `NodeFlowError` carries a stable `code`, so clients branch on that
 * rather than on a status or a message. Messages are for humans and will
 * change; codes will not.
 */

const STATUS_BY_CODE: Record<string, HttpStatus> = {
  [ErrorCode.INVALID_DEFINITION]: HttpStatus.BAD_REQUEST,
  [ErrorCode.COMPILATION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNKNOWN_TASK_TYPE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.UNKNOWN_TASK_REFERENCE]: HttpStatus.BAD_REQUEST,
  [ErrorCode.EXPRESSION_FAILED]: HttpStatus.BAD_REQUEST,
  [ErrorCode.INVALID_ARGUMENT]: HttpStatus.BAD_REQUEST,

  [ErrorCode.NOT_FOUND]: HttpStatus.NOT_FOUND,
  [ErrorCode.CONFLICT]: HttpStatus.CONFLICT,
  [ErrorCode.TERMINAL_STATE]: HttpStatus.CONFLICT,

  // 429, not 400: a limit is a "come back later", and the distinction is what
  // lets a client retry correctly instead of treating it as a permanent error.
  [ErrorCode.LIMIT_EXCEEDED]: HttpStatus.TOO_MANY_REQUESTS,

  // The lease is gone, so the worker's write was refused by the fencing check.
  // 409 rather than 403: nothing is wrong with the caller's authorization, its
  // view of the world is simply stale.
  [ErrorCode.LEASE_EXPIRED]: HttpStatus.CONFLICT,

  [ErrorCode.INTERNAL]: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      // Adapter-shaped only in this one file, which is the filter's job.
      header: (name: string, value: string) => unknown;
      status: (code: number) => { send: (body: unknown) => void };
    }>();

    if (exception instanceof NodeFlowError) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;

      // Only genuine faults reach the log at error level. A 404 or a tripped
      // limit is ordinary traffic, and logging it as an error is how a log
      // stops being worth reading during an actual incident.
      if (status >= 500) this.logger.error(exception.message, exception.stack);

      // A 429 without `Retry-After` is an invitation to hot-loop: a client that
      // is told to come back later and not told when comes back immediately.
      const retryAfter = retryAfterOf(exception);
      if (retryAfter !== undefined) response.header('retry-after', String(retryAfter));

      response.status(status).send({
        error: exception.code,
        message: exception.message,
        ...(exception.details ? { details: exception.details } : {}),
      });
      return;
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response
        .status(exception.getStatus())
        .send(typeof body === 'string' ? { error: 'error', message: body } : body);
      return;
    }

    // Anything unrecognised is a bug. Log it in full, return nothing revealing:
    // stack traces and driver messages are exactly what an attacker wants and
    // exactly what a client cannot act on.
    this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: ErrorCode.INTERNAL,
      message: 'internal server error',
    });
  }
}

/**
 * The `Retry-After` a limit carries, if it knows one.
 *
 * Read from the error's details rather than guessed: only the control that
 * tripped knows when it will admit traffic again, and a made-up number is
 * either needlessly slow or a thundering herd.
 */
function retryAfterOf(error: NodeFlowError): number | undefined {
  const details = error.details as { retryAfterSeconds?: unknown } | undefined;
  const seconds = details?.retryAfterSeconds;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.ceil(seconds)
    : undefined;
}

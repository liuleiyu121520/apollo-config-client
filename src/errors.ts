/**
 * Structured error types for apollo-config-client.
 *
 * No upstream source: new capability added on top of the node-apollo
 * base. Error messages and fields are whitelist-controlled and never
 * contain the access key secret (leak regression is covered by tests).
 */

/**
 * Base error for all errors thrown by this package.
 */
export class ApolloError extends Error {
  /** The request URL related to this error, when applicable. */
  readonly url?: string;

  constructor(message: string, url?: string) {
    super(message);
    this.name = 'ApolloError';
    this.url = url;
    // Keep `instanceof` working after transpilation to earlier targets.
    Object.setPrototypeOf(this, ApolloError.prototype);
  }
}

/**
 * Thrown when the Apollo server answers HTTP 401, i.e. the target
 * environment has accesskey enabled and the request was unsigned or
 * carried a wrong secret. One failing request is never retried by this
 * package. The default message embeds appId / URL, the three supported
 * secret configuration methods and an NTP hint; it never contains the
 * secret itself.
 */
export class ApolloUnauthorizedError extends ApolloError {
  readonly statusCode = 401;
  readonly appId: string;

  constructor(appId: string, url: string) {
    super(
      `Apollo unauthorized (HTTP 401) for appId "${appId}" at ${url}. ` +
        'The target Apollo environment may have accesskey enabled, or the ' +
        'configured access key secret is wrong. Check your secret through ' +
        'one of the three supported ways: ' +
        '(1) explicit "secret" option, ' +
        '(2) environment variable APOLLO_ACCESSKEY_SECRET (legacy, takes ' +
        'precedence) or APOLLO_ACCESS_KEY_SECRET (new name), ' +
        '(3) properties file key apollo.accesskey.secret (see README). ' +
        'Also make sure the client clock is NTP synchronized, because the ' +
        'signature carries a millisecond timestamp.',
      url
    );
    this.name = 'ApolloUnauthorizedError';
    this.appId = appId;
    Object.setPrototypeOf(this, ApolloUnauthorizedError.prototype);
  }
}

/**
 * Thrown for any non-2xx / non-304 HTTP response other than 401, and
 * for invalid JSON payloads. Carries the status code and URL.
 */
export class ApolloHttpError extends ApolloError {
  readonly statusCode: number;

  constructor(message: string, statusCode: number, url: string) {
    super(message, url);
    this.name = 'ApolloHttpError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, ApolloHttpError.prototype);
  }
}

/**
 * Thrown for connection failures and request timeouts. Carries the URL.
 */
export class ApolloNetworkError extends ApolloError {
  constructor(message: string, url?: string) {
    super(message, url);
    this.name = 'ApolloNetworkError';
    Object.setPrototypeOf(this, ApolloNetworkError.prototype);
  }
}

/**
 * Coerce an unknown thrown value into an `ApolloError`. Values that are
 * already `ApolloError` pass through unchanged; anything else becomes a
 * new `ApolloError` whose message is prefixed with `messagePrefix` and,
 * when a URL is involved, suffixed with ` (url)`.
 */
export function toApolloError(
  err: unknown,
  messagePrefix: string,
  url?: string
): ApolloError {
  if (err instanceof ApolloError) {
    return err;
  }
  const message: string = err instanceof Error ? err.message : String(err);
  return new ApolloError(`${messagePrefix}: ${message}${url ? ` (${url})` : ''}`, url);
}

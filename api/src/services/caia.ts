/**
 * CAIA OAuth Client Service
 *
 * Provides PIV smartcard authentication via Treasury's CAIA (Customer Authentication
 * & Identity Architecture) OAuth server. Uses openid-client v6 for OIDC flows.
 *
 * Credentials are stored in AWS Secrets Manager and fetched fresh on each auth flow.
 * This ensures credential updates take effect immediately without restart.
 */

import * as client from 'openid-client';
import {
  getCAIACredentials,
  type CAIACredentials,
} from './secrets-manager.js';
import { logger } from '../config/logger.js';

/**
 * User information extracted from CAIA ID token
 */
export interface CAIAUserInfo {
  /** Subject identifier (NOT persistent - do not use for permanent storage) */
  sub: string;
  /** Email address (primary identifier) */
  email: string;
  /** Given name (first name) - only available for IAL2+ */
  givenName?: string;
  /** Family name (last name) - only available for IAL2+ */
  familyName?: string;
  /** Credential Service Provider used: 'X509Cert', 'Login.gov', 'ID.me' */
  csp?: string;
  /** Identity Assurance Level */
  ial?: string;
  /** Authentication Assurance Level */
  aal?: string;
  /** Raw ID token claims */
  rawClaims: Record<string, unknown>;
}

/**
 * Authorization URL result
 */
export interface CAIAAuthorizationUrlResult {
  /** Full authorization URL to redirect user to */
  url: string;
  /** State parameter for CSRF protection */
  state: string;
  /** Nonce for replay protection */
  nonce: string;
  /** PKCE code verifier (store in session) */
  codeVerifier: string;
}

/**
 * Callback result with user info
 */
export interface CAIACallbackResult {
  /** Authenticated user information */
  user: CAIAUserInfo;
}

/**
 * Get redirect URI from environment (auto-derived from APP_BASE_URL)
 * Uses /api/auth/piv/callback to match CAIA client registration
 */
function getRedirectUri(): string {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) {
    throw new Error('APP_BASE_URL environment variable is required');
  }
  const redirectUri = `${baseUrl}/api/auth/piv/callback`;
  logger.info({ redirectUri }, 'CAIA using redirect_uri');
  return redirectUri;
}

/**
 * Check if CAIA integration is configured
 * Fetches from Secrets Manager on each call (no caching)
 */
export async function isCAIAConfigured(): Promise<boolean> {
  // In local dev without Secrets Manager, fall back to env vars
  if (process.env.NODE_ENV !== 'production') {
    return !!(
      process.env.CAIA_ISSUER_URL &&
      process.env.CAIA_CLIENT_ID &&
      process.env.CAIA_CLIENT_SECRET
    );
  }

  const result = await getCAIACredentials();
  return result.configured;
}

/**
 * Initialize CAIA client by discovering the issuer
 * Called at startup to validate configuration (optional)
 */
export async function initializeCAIA(): Promise<void> {
  const configured = await isCAIAConfigured();
  if (!configured) {
    logger.info('CAIA not configured, skipping initialization');
    return;
  }

  try {
    const config = await discoverIssuer();
    logger.info({ issuer: config.serverMetadata().issuer }, 'CAIA issuer discovered');
  } catch (err) {
    logger.error({ err }, 'Failed to discover CAIA issuer');
    throw err;
  }
}

/**
 * Discover OIDC issuer and create configuration
 * Fetches credentials fresh from Secrets Manager
 */
async function discoverIssuer(): Promise<client.Configuration> {
  logger.info('CAIA discovering issuer');
  const creds = await fetchCredentials();
  logger.info({ issuerUrl: creds.issuer_url, clientId: creds.client_id }, 'CAIA issuer credentials loaded');

  try {
    const config = await client.discovery(
      new URL(creds.issuer_url),
      creds.client_id,
      creds.client_secret,
    );
    const metadata = config.serverMetadata();
    logger.info({
      issuer: metadata.issuer,
      tokenEndpoint: metadata.token_endpoint,
      supportedAuthMethods: metadata.token_endpoint_auth_methods_supported,
    }, 'CAIA issuer discovered successfully');
    return config;
  } catch (err) {
    const error = err as Error & { cause?: unknown; code?: string };
    logger.error({ err: error, cause: error.cause }, 'CAIA discovery failed during auth flow');
    throw err;
  }
}

/**
 * Fetch credentials from Secrets Manager (or env vars in dev)
 * @throws Error if credentials not configured
 */
async function fetchCredentials(): Promise<CAIACredentials> {
  // In local dev, use env vars
  if (process.env.NODE_ENV !== 'production') {
    const issuer_url = process.env.CAIA_ISSUER_URL;
    const client_id = process.env.CAIA_CLIENT_ID;
    const client_secret = process.env.CAIA_CLIENT_SECRET;

    if (!issuer_url || !client_id || !client_secret) {
      throw new Error('CAIA not configured: set CAIA_ISSUER_URL, CAIA_CLIENT_ID, CAIA_CLIENT_SECRET');
    }

    return { issuer_url, client_id, client_secret };
  }

  // In production, fetch from Secrets Manager
  const result = await getCAIACredentials();

  if (!result.configured || !result.credentials) {
    if (result.error) {
      throw new Error(`CAIA credentials unavailable: ${result.error}`);
    }
    throw new Error('CAIA not configured: configure credentials in admin settings');
  }

  return result.credentials;
}

/**
 * Get authorization URL for CAIA login
 * Uses PKCE for security (required for public clients, recommended for all)
 */
export async function getAuthorizationUrl(): Promise<CAIAAuthorizationUrlResult> {
  const config = await discoverIssuer();
  const redirectUri = getRedirectUri();

  // Generate PKCE code verifier and challenge
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  // Generate state and nonce for security
  const state = client.randomState();
  const nonce = client.randomNonce();

  // Build authorization URL with all parameters
  const parameters: Record<string, string> = {
    redirect_uri: redirectUri,
    scope: 'openid email profile',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  };

  const authorizationUrl = client.buildAuthorizationUrl(config, parameters);

  return {
    url: authorizationUrl.href,
    state,
    nonce,
    codeVerifier,
  };
}

/**
 * Handle OAuth callback from CAIA
 * Exchanges authorization code for tokens and extracts user info
 */
export async function handleCallback(
  code: string,
  params: { state: string; nonce: string; codeVerifier: string }
): Promise<CAIACallbackResult> {
  logger.info({ codePrefix: code.substring(0, 10), state: params.state }, 'CAIA handling OAuth callback');

  const config = await discoverIssuer();
  const redirectUri = getRedirectUri();
  logger.info({ redirectUri }, 'CAIA callback redirect URI');

  // Build the callback URL that was called (with code and state)
  const callbackUrl = new URL(redirectUri);
  callbackUrl.searchParams.set('code', code);
  callbackUrl.searchParams.set('state', params.state);

  // Exchange code for tokens using openid-client v6 API
  const metadata = config.serverMetadata();
  logger.info({
    tokenEndpoint: metadata.token_endpoint,
    supportedAuthMethods: metadata.token_endpoint_auth_methods_supported,
  }, 'CAIA exchanging authorization code for tokens');

  let tokens;
  try {
    tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: params.codeVerifier,
      expectedState: params.state,
      expectedNonce: params.nonce,
      idTokenExpected: true,
    });
    logger.info('CAIA token exchange successful');
  } catch (err) {
    const error = err as Error & {
      cause?: unknown;
      code?: string;
      status?: number;
      response?: Response;
      error?: string;
      error_description?: string;
    };
    logger.error({
      err: error,
      status: error.status,
      oauthError: error.error,
      oauthErrorDescription: error.error_description,
      cause: error.cause,
    }, 'CAIA token exchange failed');
    throw err;
  }

  // Get claims from ID token (may only have sub)
  const idTokenClaims = tokens.claims();
  if (!idTokenClaims) {
    logger.error('CAIA no ID token claims in response');
    throw new Error('No ID token claims returned');
  }
  logger.info({ sub: idTokenClaims.sub, email: idTokenClaims.email, csp: idTokenClaims.csp }, 'CAIA ID token claims received');

  // Fetch additional user info from userinfo endpoint
  // CAIA puts user attributes (email, name) in userinfo, not ID token
  logger.info('CAIA fetching userinfo from endpoint');
  let userInfoClaims: Record<string, unknown> = {};
  try {
    const userInfoResponse = await client.fetchUserInfo(config, tokens.access_token, idTokenClaims.sub);
    userInfoClaims = userInfoResponse as Record<string, unknown>;
    logger.info({
      sub: userInfoClaims.sub,
      email: userInfoClaims.email,
      givenName: userInfoClaims.given_name,
      familyName: userInfoClaims.family_name,
      csp: userInfoClaims.csp,
    }, 'CAIA userinfo received');
  } catch (err) {
    logger.error({ err }, 'CAIA failed to fetch userinfo');
    // Continue with ID token claims only - some flows may not have userinfo
  }

  // Merge claims: prefer userinfo over ID token
  const claims = { ...idTokenClaims, ...userInfoClaims };

  // Type-safe claim extraction with validation
  const sub = idTokenClaims.sub; // sub always from ID token
  const email = typeof claims.email === 'string' ? claims.email : undefined;
  const givenName = typeof claims.given_name === 'string' ? claims.given_name : undefined;
  const familyName = typeof claims.family_name === 'string' ? claims.family_name : undefined;
  const csp = typeof claims.csp === 'string' ? claims.csp : undefined;
  const ial = claims.ial !== undefined ? String(claims.ial) : undefined;
  const aal = claims.aal !== undefined ? String(claims.aal) : undefined;

  const user: CAIAUserInfo = {
    sub,
    email: email || '',
    givenName,
    familyName,
    csp,
    ial,
    aal,
    rawClaims: claims as Record<string, unknown>,
  };

  return { user };
}

/**
 * Validate CAIA issuer URL by attempting discovery
 * Used by admin UI to validate credentials before saving
 *
 * @returns true if discovery succeeds, throws on failure
 */
export async function validateIssuerDiscovery(
  issuerUrl: string,
  clientId: string,
  clientSecret: string
): Promise<{ success: true; issuer: string }> {
  const discoveryUrl = `${issuerUrl.replace(/\/$/, '')}/.well-known/openid-configuration`;
  logger.info({
    issuerUrl,
    discoveryUrl,
    clientId,
    clientSecretLength: clientSecret ? clientSecret.length : 0,
  }, 'CAIA validating issuer discovery');

  try {
    const config = await client.discovery(
      new URL(issuerUrl),
      clientId,
      clientSecret,
    );

    const issuer = config.serverMetadata().issuer;
    logger.info({ issuer }, 'CAIA discovery successful');

    return {
      success: true,
      issuer,
    };
  } catch (err) {
    const error = err as Error & { cause?: unknown; code?: string };
    logger.error({
      err: error,
      issuerUrl,
      code: error.code,
      cause: error.cause,
    }, 'CAIA discovery failed');
    throw err;
  }
}

/**
 * Reset the CAIA configuration singleton (for testing)
 * With per-request credential fetching, this is now a no-op
 * but kept for API compatibility
 */
export function resetCAIAClient(): void {
  // No-op - credentials are fetched fresh each request
}

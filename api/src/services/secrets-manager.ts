/**
 * AWS Secrets Manager Service
 *
 * Provides secure storage and retrieval of sensitive credentials.
 * Used for CAIA OAuth credentials that can be configured via admin UI.
 *
 * Secret path convention: /ship/{env}/secret-name
 * Environment determined by process.env.ENVIRONMENT (defaults to 'prod')
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  PutSecretValueCommand,
  CreateSecretCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-secrets-manager';
import { logger } from '../config/logger.js';

// Lazy-initialized client to avoid keeping Node.js alive during import tests
let _client: SecretsManagerClient | null = null;

function getClient(): SecretsManagerClient {
  if (!_client) {
    _client = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return _client;
}

/**
 * Get the environment-specific base path for secrets
 */
function getBasePath(): string {
  const environment = process.env.ENVIRONMENT || 'prod';
  return `/ship/${environment}`;
}

/**
 * CAIA OAuth credentials structure
 */
export interface CAIACredentials {
  issuer_url: string;
  client_id: string;
  client_secret: string;
}

/**
 * Result of credential fetch - includes metadata about the fetch
 */
export interface CAIACredentialsResult {
  credentials: CAIACredentials | null;
  configured: boolean;
  error?: string;
}

/**
 * Get CAIA OAuth credentials from Secrets Manager
 *
 * Returns null credentials if:
 * - Secret doesn't exist (will be created as empty)
 * - Secret exists but is empty/incomplete
 * - Secrets Manager is unreachable (fail closed)
 */
export async function getCAIACredentials(): Promise<CAIACredentialsResult> {
  const secretName = `${getBasePath()}/caia-credentials`;
  logger.info({ secretName }, 'Fetching CAIA credentials');

  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await getClient().send(command);

    if (!response.SecretString) {
      logger.info('Secret exists but has no value');
      return { credentials: null, configured: false };
    }

    const parsed = JSON.parse(response.SecretString) as Partial<CAIACredentials>;

    // Check if all required fields are present and non-empty
    if (!parsed.issuer_url || !parsed.client_id || !parsed.client_secret) {
      logger.info({
        hasIssuerUrl: !!parsed.issuer_url,
        hasClientId: !!parsed.client_id,
        hasClientSecret: !!parsed.client_secret,
      }, 'Secret exists but is incomplete');
      return { credentials: null, configured: false };
    }

    logger.info({
      issuerUrl: parsed.issuer_url,
      clientId: parsed.client_id,
    }, 'CAIA credentials loaded successfully');
    return {
      credentials: {
        issuer_url: parsed.issuer_url,
        client_id: parsed.client_id,
        client_secret: parsed.client_secret,
      },
      configured: true,
    };
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      // Secret doesn't exist - create empty placeholder
      logger.info({ secretName }, 'Secret not found, creating placeholder');
      await ensureSecretExists(secretName);
      return { credentials: null, configured: false };
    }

    // Secrets Manager failure - fail closed
    logger.error({ err }, 'Failed to fetch CAIA credentials');
    return {
      credentials: null,
      configured: false,
      error: err instanceof Error ? err.message : 'Unknown error fetching credentials',
    };
  }
}

/**
 * Save CAIA OAuth credentials to Secrets Manager
 *
 * @throws Error if save fails
 */
export async function saveCAIACredentials(credentials: CAIACredentials): Promise<void> {
  const secretName = `${getBasePath()}/caia-credentials`;
  const secretValue = JSON.stringify(credentials);

  logger.info({
    secretName,
    issuerUrl: credentials.issuer_url,
    clientId: credentials.client_id,
    secretLength: credentials.client_secret?.length || 0,
  }, 'Saving CAIA credentials');

  try {
    const command = new PutSecretValueCommand({
      SecretId: secretName,
      SecretString: secretValue,
    });
    await getClient().send(command);
    logger.info('Credentials saved successfully (updated existing secret)');
  } catch (err) {
    if (err instanceof ResourceNotFoundException) {
      // Secret doesn't exist yet - create it
      logger.info('Secret not found, creating new secret');
      const createCommand = new CreateSecretCommand({
        Name: secretName,
        SecretString: secretValue,
        Description: 'CAIA OAuth credentials for PIV authentication',
      });
      await getClient().send(createCommand);
      logger.info('New secret created successfully');
      return;
    }
    logger.error({ err }, 'Failed to save credentials');
    throw err;
  }
}

/**
 * Ensure the CAIA credentials secret exists (create empty if missing)
 * Called during bootstrap to ensure admin UI can save credentials
 */
async function ensureSecretExists(secretName: string): Promise<void> {
  try {
    const createCommand = new CreateSecretCommand({
      Name: secretName,
      SecretString: JSON.stringify({}),
      Description: 'CAIA OAuth credentials for PIV authentication',
    });
    await getClient().send(createCommand);
    logger.info({ secretName }, 'Created empty secret');
  } catch (err) {
    // Ignore if secret already exists (race condition)
    const awsErr = err as { name?: string };
    if (awsErr.name === 'ResourceExistsException') {
      return;
    }
    logger.error({ err }, 'Failed to create CAIA credentials secret');
    // Don't throw - this is a bootstrap operation
  }
}

/**
 * Get the secret path for CAIA credentials (for display in admin UI)
 */
export function getCAIASecretPath(): string {
  return `${getBasePath()}/caia-credentials`;
}

/**
 * Compare two credential objects and return which fields changed
 * Used for audit logging
 */
export function getChangedFields(
  oldCreds: Partial<CAIACredentials> | null,
  newCreds: CAIACredentials
): string[] {
  const changed: string[] = [];

  if (!oldCreds) {
    // All fields are new
    return ['issuer_url', 'client_id', 'client_secret'];
  }

  if (oldCreds.issuer_url !== newCreds.issuer_url) {
    changed.push('issuer_url');
  }
  if (oldCreds.client_id !== newCreds.client_id) {
    changed.push('client_id');
  }
  if (oldCreds.client_secret !== newCreds.client_secret) {
    changed.push('client_secret');
  }

  return changed;
}

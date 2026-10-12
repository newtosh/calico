/** The private OAuth client. Phase 4 swaps in the public one. */
export const CLIENT_ID = "80700e7a799c4dd0b74304fd4bed9f76";

export interface Endpoints {
  clientId: string;
  authUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  apiUrl?: string;
  workersOrigin?: string;
}

/**
 * Where setup talks to. A test may point it at a fake Cloudflare, but a
 * packaged build ignores the environment: those endpoints receive the sign-in
 * code and the access token, so nothing that can set an environment variable
 * may redirect them.
 */
export function endpoints(
  env: Record<string, string | undefined>,
  packaged: boolean,
): Endpoints {
  if (packaged) return { clientId: CLIENT_ID };
  return {
    clientId: env.CALICO_CF_CLIENT_ID || CLIENT_ID,
    authUrl: env.CALICO_CF_AUTH_URL,
    tokenUrl: env.CALICO_CF_TOKEN_URL,
    revokeUrl: env.CALICO_CF_REVOKE_URL,
    apiUrl: env.CALICO_CF_API_URL,
    workersOrigin: env.CALICO_CF_WORKERS_ORIGIN,
  };
}

import { OAuth2Client } from 'google-auth-library';
import type { Config } from './config.js';

export interface User {
  email: string;
  name?: string;
}

export type Authenticator = (authorizationHeader: string | undefined) => Promise<User | null>;

/**
 * Verifies the Google ID token the dashboard sends as `Authorization: Bearer <token>`.
 * Only verified email addresses are accepted. Which games the user sees is decided
 * separately from ACCESS_JSON (see access.ts).
 */
export function googleAuthenticator(config: Config): Authenticator {
  if (config.DEV_AUTH_EMAIL) {
    const email = config.DEV_AUTH_EMAIL;
    return async () => ({ email, name: 'Local developer' });
  }
  const clientId = config.GOOGLE_CLIENT_ID!;
  const client = new OAuth2Client(clientId);
  return async (header) => {
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) return null;
    try {
      const ticket = await client.verifyIdToken({ idToken: token, audience: clientId });
      const payload = ticket.getPayload();
      if (!payload?.email || !payload.email_verified) return null;
      return { email: payload.email.toLowerCase(), name: payload.name };
    } catch {
      return null;
    }
  };
}

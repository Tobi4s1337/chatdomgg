/**
 * Public Twitch facts about one person, read with the app's own token: their login, display name and chat colour.
 * These are what Twitch shows anyone on a profile and in chat; nothing private is requested and no user token is
 * involved. Answers are cached for ten minutes per person, and a Helix failure is an absence, never a guess.
 */
export interface TwitchPerson { readonly login: string; readonly displayName: string; readonly colour: string | null }
export interface TwitchUsers { person(personId: string, signal?: AbortSignal): Promise<TwitchPerson | null> }

const LOGIN = /^[a-z0-9_]{1,25}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const TTL_MS = 10 * 60_000, LIMIT = 5_000;

export function createTwitchUsers(credentials: { clientId: string; clientSecret: string } | null, fetcher: typeof fetch = fetch): TwitchUsers {
  let token: { value: string; until: number } | null = null;
  let tokenRequest: Promise<string | null> | null = null;
  const cache = new Map<string, { at: number; person: TwitchPerson | null }>();

  const appToken = async (): Promise<string | null> => {
    if (!credentials) return null;
    if (token && token.until > Date.now()) return token.value;
    tokenRequest ??= (async () => {
      try {
        const response = await fetcher('https://id.twitch.tv/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'client_credentials' }),
          signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return null;
        const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
        if (typeof body.access_token !== 'string') return null;
        const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
        token = { value: body.access_token, until: Date.now() + Math.max(60, seconds - 300) * 1000 };
        return token.value;
      } catch { return null; } finally { tokenRequest = null; }
    })();
    return tokenRequest;
  };

  const helix = async (path: string, signal?: AbortSignal): Promise<unknown> => {
    const value = await appToken();
    if (!value || !credentials) return null;
    const response = await fetcher(`https://api.twitch.tv/helix/${path}`, {
      headers: { Authorization: `Bearer ${value}`, 'Client-Id': credentials.clientId },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
    });
    if (response.status === 401) { token = null; return null; }
    if (!response.ok) return null;
    return response.json();
  };

  return {
    async person(personId, signal) {
      const cached = cache.get(personId);
      if (cached && Date.now() - cached.at < TTL_MS) return cached.person;
      try {
        const [users, colours] = await Promise.all([
          helix(`users?id=${encodeURIComponent(personId)}`, signal) as Promise<{ data?: { login?: unknown; display_name?: unknown }[] } | null>,
          helix(`chat/color?user_id=${encodeURIComponent(personId)}`, signal) as Promise<{ data?: { color?: unknown }[] } | null>,
        ]);
        const user = users?.data?.[0];
        const login = typeof user?.login === 'string' && LOGIN.test(user.login) ? user.login : null;
        const displayName = typeof user?.display_name === 'string' && user.display_name.trim() ? user.display_name.trim() : login;
        const colour = colours?.data?.[0]?.color;
        const person = login && displayName ? { login, displayName, colour: typeof colour === 'string' && COLOUR.test(colour) ? colour.toLowerCase() : null } : null;
        // Only a definite answer is remembered; a failed read is asked again on the next request.
        if (users) {
          cache.set(personId, { at: Date.now(), person });
          if (cache.size > LIMIT) cache.delete(cache.keys().next().value!);
        }
        return person;
      } catch { return null; }
    },
  };
}

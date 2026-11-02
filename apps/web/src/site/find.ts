// "Find any channel" on the story page's Atlas: what a visitor types, read as a Twitch name.

/** Twitch names as the map's routes take them (`/map/<login>`). */
const LOGIN = /^[a-z0-9_]{1,25}$/;

/**
 * The Twitch name in what someone typed: a name, an @name, or a link to the channel (`twitch.tv/name`, with or without
 * `https://www.` and a trailing path). Null when it cannot be a name.
 */
export function readLogin(typed: string): string | null {
  let text = typed.trim().toLowerCase();
  const link = /^(?:https?:\/\/)?(?:www\.|m\.)?twitch\.tv\/([^/?#\s]+)/.exec(text);
  if (link) text = link[1]!;
  text = text.replace(/^@/, '');
  return LOGIN.test(text) ? text : null;
}

/** Where the full map shows a channel. */
export const mapPath = (login: string): string => `/map/${login}`;

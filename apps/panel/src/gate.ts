/** The kingdom lives on chatdom.io; the realm sends its walk as a full address, so this base only fills in a bare path. */
const CHATDOM = 'https://chatdom.io';

/** Where a "Walk in" link leads. Mounted inside the web app for review (`/panel`), the same app serves the gate. */
export function gateHref(path: string, at: Pick<Location, 'pathname' | 'origin'> = location): string {
  const inWebApp = /\/panel\/?$/.test(at.pathname);
  return new URL(path, inWebApp ? at.origin : CHATDOM).href;
}

/** The site a gate leads to, in the words the link uses ("chatdom.io"). */
export const hostOf = (path: string, at: Pick<Location, 'pathname' | 'origin'> = location) => new URL(gateHref(path, at)).host;

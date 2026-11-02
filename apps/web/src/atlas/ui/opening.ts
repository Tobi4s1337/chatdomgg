/** The map's invitation into Chatdom: the way in's words and the first visit's opening caption. */

/** The words of the way in, shared with the default view's word count. */
export const WAY_IN_LABEL = 'Walk into a kingdom';
/** The opening caption a first visit reads under the title. */
export const OPENING_LINE = 'Every Twitch channel is a kingdom on this map. Step into one.';
/** Set once the opening caption has been shown in this browser, so a return visit opens quietly. */
export const OPENING_SEEN_KEY = 'chatdom:atlas:opening:v1';

/** Whether this browser should read the opening caption: only the first time, and it is marked read at once. */
export function takeOpening(storage: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  if (!storage) return false;
  try {
    if (storage.getItem(OPENING_SEEN_KEY)) return false;
    storage.setItem(OPENING_SEEN_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

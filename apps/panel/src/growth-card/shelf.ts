import { PersonIdSchema } from '../../../../packages/shared/src/identity';
import { PassportBookSchema } from '../../../../packages/shared/src/passport';
import { createPassportSession, followDisclosure, type PassportDisclosureView, type PassportTransport } from '../../../../packages/ui/src/passport/session';
import type { KeepsakeView } from '../../../../packages/ui/src/passport/types';

export type ShelfState =
  | { readonly kind: 'loading' | 'unavailable' | 'invalid'; readonly origin?: 'live' | 'simulated' }
  | { readonly kind: 'hidden' | 'empty'; readonly origin: 'live' | 'simulated' }
  | { readonly kind: 'ready'; readonly origin: 'live' | 'simulated'; readonly items: readonly KeepsakeView[]; readonly hasMore: boolean };

/** A host supplies a checked passport transport for the named subject, and the card's disclosure. */
export function createEarnedShelf(receive: (state: ShelfState) => void) {
  let close = () => {};
  let generation = 0;
  const revisions = new Map<string, { hiddenAt: number; shownAt: number }>();
  return {
    replace(subject: string | null, disclosure: PassportDisclosureView | null, transport: PassportTransport | null) {
      const current = ++generation;
      close(); close = () => {};
      if (!subject || !disclosure) { receive({ kind: 'unavailable' }); return; }
      if (!PersonIdSchema.safeParse(subject).success) { receive({ kind: 'invalid' }); return; }
      if (!Number.isSafeInteger(disclosure.revision) || disclosure.revision < 0 || !['live', 'simulated'].includes(disclosure.origin) || !['shown', 'hidden'].includes(disclosure.travels)) { receive({ kind: 'invalid' }); return; }
      const { origin, travels, revision: revisionNumber } = disclosure;
      const key = `${origin}:${subject}`;
      const revision = revisions.get(key) ?? { hiddenAt: -1, shownAt: -1 };
      revisions.set(key, revision);
      if (travels === 'hidden') { revision.hiddenAt = Math.max(revision.hiddenAt, revisionNumber); receive({ kind: 'hidden', origin }); return; }
      if (revisionNumber <= revision.hiddenAt || revisionNumber < revision.shownAt) { receive({ kind: 'hidden', origin }); return; }
      revision.shownAt = revisionNumber;
      if (!transport) { receive({ kind: 'unavailable', origin }); return; }
      receive({ kind: 'loading', origin });
      if (generation !== current) return;
      const session = createPassportSession(async (request, signal) => {
        const reply = await transport(request, signal);
        if (reply?.kind === 'denied' && reply.code === 'invalid') return undefined;
        if (reply?.kind !== 'book') return reply;
        const checked = PassportBookSchema.safeParse(reply.book);
        return checked.success ? { kind: 'book', book: checked.data } : undefined;
      });
      const unsubscribe = session.subscribe(state => {
        if (generation !== current) return;
        if (state.kind === 'pending') return;
        if (state.kind === 'hidden') return receive(state.origin === origin ? { kind: 'hidden', origin: state.origin } : { kind: 'invalid', origin });
        if (state.kind === 'unavailable') return receive({ kind: state.cause === 'malformed' ? 'invalid' : 'unavailable', origin });
        const result = PassportBookSchema.safeParse(state.book);
        if (!result.success || result.data.visibility !== 'visible' || result.data.holder.personId !== subject || result.data.origin !== origin) return receive({ kind: 'invalid', origin });
        const page = result.data.keepsakes;
        if (!page.items.length && !page.nextCursor) return receive({ kind: 'empty', origin: result.data.origin });
        receive({ kind: 'ready', origin: result.data.origin, items: page.items.slice(0, 3), hasMore: page.items.length > 3 || page.nextCursor !== null });
      });
      close = () => { unsubscribe(); session.close(); };
      followDisclosure(session)({ origin, travels, revision: revisionNumber });
    },
    close() { ++generation; close(); close = () => {}; receive({ kind: 'unavailable' }); },
  };
}

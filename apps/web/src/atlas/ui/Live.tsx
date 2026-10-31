import { createEffect, onCleanup, Show } from 'solid-js';
import type { Geography } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import type { Dab } from '../live/paint';
import { formatMoment } from './format';
import { liveLine, type LiveSummary } from './live-line';

export { LIVE_CLASS_NAMES, liveLine, type LiveSummary } from './live-line';

export function LiveSeal(props: { summary: LiveSummary }) {
  const line = () => liveLine(props.summary);
  return (
    <p class="atlas-live" data-tone={line().tone} role="status" title={props.summary.status.frameAsOf ? `Observed ${formatMoment(props.summary.status.frameAsOf)}` : undefined}>
      <span class="atlas-live-mark" aria-hidden="true" />
      <span>{line().text}</span>
    </p>
  );
}

/**
 * A pencil flag's card: a small live channel (5–24 average viewers) with no land of its own. The live layer carries
 * no names, so the card does not invent one; it says where the stream is pencilled in and since when it is on air.
 */
export function DabCard(props: { dab: Dab; world: PreviewWorld; geo: Geography; asOf: number | null; onClose: () => void }) {
  let closeButton: HTMLButtonElement | undefined;
  const realm = () => props.geo.realms[props.dab.realm];
  const region = () => props.world.regions[props.dab.region];
  createEffect(() => {
    void props.dab.hash;
    queueMicrotask(() => closeButton?.focus({ preventScroll: true }));
  });
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') props.onClose();
  };
  window.addEventListener('keydown', onKey);
  onCleanup(() => window.removeEventListener('keydown', onKey));
  return (
    <section class="atlas-card" aria-labelledby="atlas-card-title" data-kind="dab">
      <button ref={(element) => (closeButton = element)} class="atlas-card-close" type="button" onClick={() => props.onClose()} aria-label="Close card">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
      </button>
      <header class="atlas-card-head">
        <svg class="atlas-card-flag" viewBox="0 0 40 52" width="40" height="52" aria-hidden="true">
          <path d="M12 48V8" />
          <path d="M12.6 9.5c6 1.6 11-1.8 17 0.6-2.4 3-2.6 6.4 0.4 9.6-6.2-2-11.2 1.4-17.4-0.4z" />
        </svg>
        <div class="atlas-card-names">
          <p class="atlas-card-status">On air · no land of its own</p>
          <h2 id="atlas-card-title" class="atlas-card-unnamed">A small stream</h2>
        </div>
      </header>
      <dl class="atlas-card-facts">
        <Show when={realm()}>
          {(r) => (
            <div>
              <dt>Pencilled in</dt>
              <dd>
                <Show when={region()?.kind === 'continent'}>{r().name} · </Show>
                <span lang={region()?.language ?? undefined}>{region()?.name}</span>
                <Show when={region() && region()!.englishName !== region()!.name}><span class="atlas-quiet"> · {region()!.englishName}</span></Show>
              </dd>
            </div>
          )}
        </Show>
        <div><dt>On air since</dt><dd>{formatMoment(props.dab.startedAt)}</dd></div>
        <div><dt>Audience</dt><dd>5–24 viewers on average <span class="atlas-quiet">· pencil flag</span></dd></div>
      </dl>
      <p class="atlas-card-note">
        Small live channels are pencilled in near the realm of their language and game while they are on air, at a
        place drawn from their channel ID. The live layer carries no names, so none is shown here. The flag is rubbed
        out when the stream ends{props.asOf ? `; this is the sweep of ${formatMoment(props.asOf)}` : ''}.
      </p>
    </section>
  );
}

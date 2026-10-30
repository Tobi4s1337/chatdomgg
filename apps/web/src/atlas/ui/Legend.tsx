import { For, Show } from 'solid-js';
import type { PreviewWorld } from '../data/preview';
import { formatCount, formatDay, formatDayRange, formatSpan, sweepCadence, TIER_NAMES } from './format';
import { ShieldIcon, StampIcon } from './marks';

const GROUPS = ['capital', 'city', 'town', 'village'] as const;

/** The key: what each mark means and exactly what was observed, so nobody mistakes the draft for an edition. */
export function LegendBody(props: { world: PreviewWorld }) {
  const w = () => props.world;
  const cadence = () => sweepCadence(w().window.hours, w().window.sweeps);
  const continents = () => w().regions.filter((region) => region.kind === 'continent').length;
  const isles = () => w().regions.length - continents();
  const sample = () => w().head.ids[0];
  return (
    <>
      <ul class="atlas-key-tiers">
        <For each={GROUPS}>
          {(group, i) => (
            <li>
              <span class="atlas-key-mark"><StampIcon group={group} width={[32, 28, 25, 22][i()]!} /></span>
              <span class="atlas-key-name">{TIER_NAMES[i()]} <span class="atlas-key-count">{formatCount(w().counts[group])}</span></span>
              <span class="atlas-key-rule">{formatCount(w().tiers.minAverage[group])}+ avg. viewers</span>
            </li>
          )}
        </For>
      </ul>
      <ul class="atlas-key-notes">
        <Show when={sample()}>
          {(id) => (
            <li>
              <span class="atlas-key-mark"><ShieldIcon channelId={id()} width={16} /></span>
              <span>Every channel bears arms drawn from its channel ID.</span>
            </li>
          )}
        </Show>
        <li>
          <span class="atlas-key-mark"><span class="atlas-key-swatch" aria-hidden="true" /></span>
          <span>
            {continents()} continents for languages with 600+ channels; {isles()} smaller tongues form {w().isles?.name ?? 'the isles'}.
            Within a land, channels gather by the category they stream most.
          </span>
        </li>
      </ul>
      <p class="atlas-key-survey">
        Observed {formatDayRange(w().window.firstObservationAt, w().window.lastObservationAt)} (UTC) for {formatSpan(w().window.hours)}:
        {' '}{formatCount(w().window.sweeps)} sweeps of every live channel with {w().coverage.sweepFloorViewers}+ viewers{cadence() ? `, ${cadence()}` : ''}.
        {' '}{formatCount(w().counts.mapped)} of {formatCount(w().counts.channelsObserved)} observed channels averaged {w().coverage.candidateMinAverage}+ and hold land.
        <Show when={w().policy.excludedGambling > 0}>
          {' '}{formatCount(w().policy.excludedGambling)} gambling {w().policy.excludedGambling === 1 ? 'channel is' : 'channels are'} left off the map.
        </Show>
      </p>
      <p class="atlas-key-survey">
        Draft land, not an edition: nothing here is founded yet and holdings may still move. The first edition can be
        drawn from {formatDay(w().founding.edition0EligibleAt)}. Content labels were not collected. Names show only
        while the survey has seen them within a day.
      </p>
    </>
  );
}

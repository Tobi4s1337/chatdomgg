// Tonight's shared moment, under the window: a world vote, the King's Errand or the
// dragon. One tap is one chat command with chat's own limits, so watching is playable
// with chat closed, and the panel never does more than one message could.
import { For, Match, Show, Switch } from 'solid-js';
import type { CrowdAct, PanelSnapshot } from '../model';
import { RaisingMeter } from './places';

type Click = (event: MouseEvent & { currentTarget: HTMLButtonElement }) => void;

const label = (act: CrowdAct, option: string) => act.options.find(o => o.id === option)?.label ?? option;

/** The words the kingdom answers with. Pending is never counted; only accepted is. */
function answer(act: CrowdAct): { title: string; detail: string } | null {
  const status = act.status;
  switch (status.kind) {
    case 'pending': return { title: act.kind === 'vote' ? 'Casting your vote…' : act.kind === 'errand' ? 'Hauling…' : 'Striking…', detail: 'Waiting for the kingdom to count it.' };
    case 'accepted': return act.kind === 'vote'
      ? { title: `Your vote is counted: ${label(act, status.option)}`, detail: `${act.limit}${act.closes ? ` Closes at ${act.closes}.` : ''}` }
      : { title: act.kind === 'errand' ? 'Your stone is on the scaffold' : 'Your strike landed', detail: act.limit };
    case 'limited': return { title: 'Not yet', detail: `${status.words} ${act.limit}` };
    default: return null;
  }
}

export function ActSlip(props: { snap: PanelSnapshot; act: CrowdAct; onAct: (option: string) => void; onLight: Click }) {
  const act = () => props.act;
  const status = () => props.act.status;
  const resting = () => { const s = status(); return s.kind === 'accepted' && s.restMs ? s.restMs : s.kind === 'limited' ? s.restMs : null; };
  return <section class="cp-slip cp-act" data-act={act().kind} data-act-status={status().kind} aria-label={act().title}>
    <p class="cp-label cp-act-head"><span>{act().title}</span><Show when={act().closes && status().kind !== 'ended'}><span class="cp-act-closes">Closes {act().closes}</span></Show></p>
    <Switch>
      <Match when={status().kind === 'ended' ? status() as Extract<CrowdAct['status'], { kind: 'ended' }> : null}>{ended =>
        <p class="cp-act-outcome"><span class="cp-act-seal" aria-hidden="true" />{ended().outcome}</p>}
      </Match>
      <Match when={status().kind === 'unavailable' ? status() as Extract<CrowdAct['status'], { kind: 'unavailable' }> : null}>{gone => <>
        <p class="cp-slip-text cp-act-prompt">{act().prompt}</p>
        <p class="cp-act-gate">
          <span>{gone().reason}</span>
          <Show when={gone().way === 'light'}><button type="button" class="cp-inline-action" onClick={props.onLight}>Light your window</button></Show>
        </p>
      </>}
      </Match>
      <Match when={true}>
        <p class="cp-slip-text cp-act-prompt">{act().prompt}</p>
        <Show when={act().raising}>{raising => <RaisingMeter raising={raising()} compact />}</Show>
        <Show when={answer(act())} fallback={
          <div class="cp-act-options" classList={{ single: act().options.length === 1 }}>
            <For each={act().options}>{option =>
              <button type="button" class="cp-act-button" onClick={() => props.onAct(option.id)}>
                <strong>{option.label}</strong><small>as <span class="cp-command">{act().command}{act().kind === 'vote' ? ` ${option.id}` : ''}</span> in chat</small>
              </button>}
            </For>
          </div>}>{words =>
          <div class="cp-act-answer" role="status" classList={{ limited: status().kind === 'limited', counted: status().kind === 'accepted', pending: status().kind === 'pending' }}>
            <p><strong>{words().title}</strong><small>{words().detail}</small></p>
            {/* Chat's own pause, drawn as a draining groove. The tap comes back when it ends. */}
            <Show when={resting()}>{ms => <span class="cp-act-rest" aria-hidden="true"><i style={{ 'animation-duration': `${ms()}ms` }} /></span>}</Show>
          </div>}
        </Show>
      </Match>
    </Switch>
  </section>;
}

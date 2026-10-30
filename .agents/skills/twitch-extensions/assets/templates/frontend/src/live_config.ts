/**
 * Live configuration view (live_config.html): the broadcaster's dashboard while live.
 * Privileged actions go to the EBS, which checks role === "broadcaster" in the verified JWT.
 * Also demonstrates Twitch.ext.send(): the frontend can publish to PubSub ONLY with a broadcaster token.
 */
import './style.css';
import { $, EbsError, ebsFetch, ext, firstAuth, listenJson, onPollConfig, setText, syncTheme, type PollConfig, type PollState } from './lib/ext.ts';

syncTheme();
let config: PollConfig | null = null;
let tallies: number[] = [];

function render(): void {
  $('options').replaceChildren(
    ...(config?.options ?? []).map((label, i) => {
      const li = document.createElement('li');
      li.textContent = `${label}: ${tallies[i] ?? 0}`;
      return li;
    }),
  );
}

onPollConfig((cfg) => {
  config = cfg;
  render();
});
listenJson<PollState>('broadcast', (msg) => {
  if (msg.type === 'poll_state') {
    tallies = msg.tallies;
    render();
  }
});
void firstAuth.then(async () => {
  try {
    tallies = (await ebsFetch<PollState>('/api/state')).tallies;
    render();
  } catch {
    setText('status', 'EBS unreachable.');
  }
});

$('reset').addEventListener('click', () => {
  ebsFetch('/api/reset', { method: 'POST' })
    .then(() => setText('status', 'Votes reset.'))
    .catch((err: unknown) => setText('status', err instanceof EbsError ? err.message : 'Reset failed'));
});

$('announce').addEventListener('click', () => {
  // Direct frontend → PubSub publish (broadcaster JWT only; counts against the same channel rate limit).
  ext.send('broadcast', 'application/json', { type: 'announce', text: 'Poll is open — vote now!' });
  setText('status', 'Sent.');
});

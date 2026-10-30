/**
 * Viewer view (panel.html + mobile.html): show poll, vote via EBS, live tallies via Extension PubSub,
 * optional Bits "boost" (only when features.isBitsEnabled).
 */
import './style.css';
import {
  $,
  EbsError,
  ebsFetch,
  ext,
  firstAuth,
  isLoggedIn,
  listenJson,
  onPollConfig,
  query,
  setText,
  syncTheme,
  type PollConfig,
  type PollState,
} from './lib/ext.ts';

syncTheme();
if (query.platform === 'mobile') document.body.classList.add('is-mobile');

let config: PollConfig | null = null;
let state: PollState | null = null;
let myOption: number | null = null;

function render(): void {
  if (!config) {
    setText('question', 'The streamer has not set up a poll yet.');
    $('options').replaceChildren();
    return;
  }
  setText('question', config.question);
  const list = $('options');
  list.replaceChildren(
    ...config.options.map((label, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.textContent = `${label} — ${state?.tallies[i] ?? 0}`; // textContent: never innerHTML
      btn.disabled = myOption !== null;
      btn.addEventListener('click', () => void vote(i));
      li.append(btn);
      return li;
    }),
  );
}

async function vote(option: number): Promise<void> {
  if (!isLoggedIn()) {
    setText('status', 'Log in to Twitch to vote.');
    return;
  }
  try {
    await ebsFetch('/api/vote', { method: 'POST', body: { option } });
    myOption = option;
    setText('status', 'Vote counted!');
    updateBoostButton();
  } catch (err) {
    setText('status', err instanceof EbsError ? err.message : 'Could not reach the server, try again.');
  }
  render();
}

// Config service: broadcaster segment arrives on load (no EBS traffic needed for it).
onPollConfig((cfg) => {
  config = cfg;
  render();
});

// Live updates: EBS → Helix Send Extension PubSub Message → every viewer's listen('broadcast').
listenJson<PollState>('broadcast', (msg) => {
  if (msg.type === 'poll_state' && (!state || msg.version >= state.version)) {
    state = msg;
    render();
  }
});

// Initial state from the EBS (PubSub only carries changes). Wait for the JWT first.
void firstAuth.then(async () => {
  try {
    state = await ebsFetch<PollState>('/api/state');
    render();
  } catch {
    setText('status', 'Live results unavailable right now.'); // fail gracefully, keep UI usable
  }
});

// ───────────── Bits (optional) ─────────────
const BOOST_SKU = 'boost_vote';

function updateBoostButton(): void {
  const btn = $('boost') as HTMLButtonElement;
  // Mandatory check for monetized extensions; hide Bits UI where it cannot work.
  btn.hidden = !ext.features.isBitsEnabled || myOption === null;
}

ext.features.onChanged(updateBoostButton);
void firstAuth.then(updateBoostButton);

$('boost').addEventListener('mouseenter', () => ext.bits.showBitsBalance());
$('boost').addEventListener('click', () => {
  // Uncomment while developing to avoid real transactions (no receipt in loopback):
  // ext.bits.setUseLoopback(true);
  ext.bits.useBits(BOOST_SKU);
});

ext.bits.onTransactionComplete((tx) => {
  if (tx.initiator !== 'current_user' || !tx.transactionReceipt) return;
  // Forward the receipt; the EBS verifies it with the extension secret before granting anything.
  void ebsFetch('/api/bits/receipt', { method: 'POST', body: { receipt: tx.transactionReceipt, option: myOption } })
    .then(() => setText('status', 'Boost applied!'))
    .catch(() => setText('status', 'Boost could not be verified.'));
});
ext.bits.onTransactionCancelled(() => setText('status', ''));

ext.onError((e) => console.error('[twitch-ext]', e));

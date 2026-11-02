// Development-only entry. It is not an Extension build input.
// Every gift emblem on parchment, at the largest and smallest shelf sizes, plus the fallback for an unknown id.
import { For } from 'solid-js';
import { render } from 'solid-js/web';
import { GIFT_EMBLEM_IDS, GiftEmblem } from './emblems';

const ids = [...GIFT_EMBLEM_IDS, 'unknown'];
const page = 'margin:0;padding:18px 20px;background:#ead9b8;color:#493324;font:400 12px/1.2 Georgia,serif';
const grid = (size: number) => `display:grid;grid-template-columns:repeat(auto-fill,minmax(${size + 44}px,1fr));gap:12px 6px;margin:8px 0 22px`;

function Sheet() {
  return (
    <main style={page}>
      <For each={[56, 36]}>{size => (
        <section>
          <h2 style="margin:0;font:400 16px Georgia,serif">{size} px</h2>
          <div style={grid(size)}>
            <For each={ids}>{id => (
              <figure style="margin:0;display:grid;justify-items:center;gap:4px">
                <GiftEmblem giftId={id} class="emblem" />
                <figcaption style="font-size:12px">{id}</figcaption>
              </figure>
            )}</For>
          </div>
          <style>{`section:nth-of-type(${size === 56 ? 1 : 2}) .emblem { width: ${size}px; height: ${size}px; }`}</style>
        </section>
      )}</For>
    </main>
  );
}

const root = document.getElementById('root');
if (root) render(() => <Sheet />, root);
document.body.style.margin = '0';
void document.fonts.ready.then(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });

/**
 * The one page a person sees from Herald's grant helper: the end of the Twitch consent round trip.
 * Plain words, no detail from Twitch, nothing loaded from elsewhere.
 */
export interface PageCopy {
  readonly tone: 'done' | 'stopped';
  readonly title: string;
  readonly body: string;
}

export function renderPage(copy: PageCopy): string {
  const accent = copy.tone === 'done' ? '#f2b45a' : '#c98a7a';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(copy.title)} · Chatdom Herald</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    font: 17px/1.55 ui-serif, Georgia, "Iowan Old Style", serif; color: #efe6d6;
    background: radial-gradient(120% 90% at 50% 110%, #3a2a3f 0%, #1d1a33 45%, #0f1022 100%);
  }
  main {
    width: min(520px, 100%); padding: 36px 34px 30px; border-radius: 18px;
    background: linear-gradient(180deg, rgba(43, 36, 62, 0.92), rgba(27, 24, 44, 0.94));
    border: 1px solid rgba(242, 180, 90, 0.18);
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 236, 200, 0.06);
  }
  .lamp {
    width: 14px; height: 14px; border-radius: 3px; margin-bottom: 22px; background: ${accent};
    box-shadow: 0 0 18px 4px ${accent}66, 0 0 46px 12px ${accent}22;
  }
  .mark { font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: 0.16em; text-transform: uppercase; color: #a99fbc; }
  h1 { margin: 10px 0 12px; font-size: 27px; line-height: 1.2; font-weight: 600; color: #fbf3e4; }
  p { margin: 0; color: #d9cfbf; }
  .after { margin-top: 22px; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; color: #a99fbc; }
</style>
</head>
<body>
<main>
  <div class="lamp" aria-hidden="true"></div>
  <div class="mark">Chatdom · Herald</div>
  <h1>${escapeHtml(copy.title)}</h1>
  <p>${escapeHtml(copy.body)}</p>
  <p class="after">You can close this tab. The terminal has the full result.</p>
</main>
</body>
</html>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

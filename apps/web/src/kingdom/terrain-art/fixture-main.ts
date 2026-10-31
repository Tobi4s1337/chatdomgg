import type { PostQuality } from '@chatdom/render';
import { createPictureLandFixture, FIXTURE_VIEWS, type FixtureView } from './fixture';

/**
 * Development entry for the picture-land fixture. Served by the Vite dev server at
 * /src/kingdom/terrain-art/fixture.html; it is not part of the shipped app's routes.
 * ?view=street|west · ?hour=18.9 · ?land=accepted (same view on the unsculpted ground)
 * · ?eye=x,y,z&target=x,y,z&fov=n for an explicit framing.
 */
const query = new URLSearchParams(location.search);
const triple = (value: string | null): [number, number, number] | undefined => {
  const parts = value?.split(',').map(Number);
  return parts && parts.length === 3 && parts.every(Number.isFinite) ? [parts[0]!, parts[1]!, parts[2]!] : undefined;
};
const preset = FIXTURE_VIEWS[query.get('view') ?? 'street'] ?? FIXTURE_VIEWS.street!;
const view: FixtureView = { eye: triple(query.get('eye')) ?? preset.eye, target: triple(query.get('target')) ?? preset.target,
  fov: Number(query.get('fov')) || preset.fov };
const hour = Number(query.get('hour') ?? 18.9);
const quality = (['low', 'balanced', 'high', 'capture'].includes(query.get('quality') ?? '') ? query.get('quality') : 'capture') as PostQuality;
const accepted = query.get('land') === 'accepted';
const canvas = document.getElementById('land') as HTMLCanvasElement;
const label = document.getElementById('label')!;
if (accepted) label.firstChild!.textContent = 'Fixture · accepted ground';
const state = window as Window & { __chatdomReady?: boolean; __pictureLand?: unknown };

const fixture = await createPictureLandFixture(canvas, { hour: Number.isFinite(hour) ? hour : 18.9, view, quality, accepted,
  onProgress: text => { document.title = `Chatdom · ${text}`; } });
fixture.draw(0);
fixture.light();
const started = performance.now();
const settle = (): void => {
  fixture.draw(4);
  if (fixture.lightSettled || performance.now() - started > 90_000) {
    fixture.draw(4); fixture.finish();
    state.__pictureLand = { landSeconds: fixture.landSeconds, settled: fixture.lightSettled };
    state.__chatdomReady = true;
    return;
  }
  setTimeout(settle, 250);
};
settle();

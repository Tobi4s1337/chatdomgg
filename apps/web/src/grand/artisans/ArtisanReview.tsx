import { onCleanup, onMount } from 'solid-js';
import { mountArtisanReview } from './review';
import './review.css';

/** An explicitly simulated art bench; it never presents an installed grand kingdom. */
export function ArtisanReview() {
  let root!: HTMLDivElement;
  let disposed = false;
  let release: (() => void) | undefined;
  onMount(() => {
    void mountArtisanReview(root).then(cleanup => {
      if (disposed) cleanup();
      else release = cleanup;
    });
  });
  onCleanup(() => { disposed = true; release?.(); });
  return <div ref={element => { root = element; }} class="artisan-review">
    <div class="artisan-sky" />
    <canvas class="artisan-scene" />
    <div class="artisan-caption"><strong>GRAND ARTISANS</strong><span class="artisan-subject">Preparing the clay…</span></div>
    <div class="artisan-error" role="status" />
  </div>;
}

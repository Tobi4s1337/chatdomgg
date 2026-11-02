import { onMount } from 'solid-js';
import type { RaidWelcomeStatus } from './adapter';
import WelcomeNotice from './WelcomeNotice';

/** Presentation fixture only: this page does not contact a room or attest an arrival. */
export default function NoticeBench() {
  const state = new URLSearchParams(location.search).get('state');
  const status: RaidWelcomeStatus = state === 'choice' ? { kind: 'choice', message: 'This raid’s arrival window has ended. You can still visit the kingdom.' }
    : state === 'pending' ? { kind: 'pending', message: 'You are inside. The gate has not confirmed your raid arrival yet.' }
      : state === 'unavailable' ? { kind: 'unavailable', message: 'You are inside. Your raid arrival could not be checked right now.' }
        : { kind: 'confirmed', message: 'Welcome, Wren, with MashaD4’s raid.', watchUrl: 'https://www.twitch.tv/fernhollow' };
  onMount(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });
  return <div class="raid-notice-bench" data-origin="simulated">
    <WelcomeNotice status={status} enterOrdinarily={() => undefined} />
  </div>;
}

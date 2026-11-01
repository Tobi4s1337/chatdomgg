import { Show, type JSX } from 'solid-js';
import type { HomeProgressState } from './adapter';
import '../kit.css';
import './growth-card.css';

const stageName = (stage: string) => stage.charAt(0).toUpperCase() + stage.slice(1).replaceAll('-', ' ');
const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;

/** A card inset; its caller owns the subject and subscription lifecycle. */
export function HomeProgress(props: { state: HomeProgressState }): JSX.Element {
  return <section class="gc-card" aria-label="Home progress">
    <div class="gc-paper">
      <header class="gc-heading"><div><p class="gc-kicker">A place to come home to</p><h2>Home growth</h2></div><span class="gc-mark" aria-hidden="true">✦</span></header>
      <Show when={props.state.label === 'SIMULATED'}><p class="gc-simulated">SIMULATED</p></Show>
      <Show when={props.state.kind === 'ready' ? props.state : undefined} fallback={
        <p class="gc-message" role="status">{props.state.kind === 'loading' ? 'Gathering home progress…' : props.state.kind === 'invalid' ? 'Home progress could not be verified.' : props.state.kind === 'empty' ? 'No home progress in this snapshot.' : 'Home progress is unavailable.'}</p>
      }>{ready => <>
        <div class="gc-stage"><span>HOME TODAY</span><strong>{stageName(ready().home.stage)}</strong><p>{days(ready().home.qualifiedDays)} of showing up</p></div>
        <div class="gc-goal"><Show when={ready().home.nextGoal} fallback={<><span>{ready().home.stage === 'hall' ? 'HOME COMPLETE' : 'NEXT HOME'}</span><p>{ready().home.stage === 'hall' ? 'Your home has reached its highest stage.' : 'No next goal is available.'}</p></>}>
          {goal => <><span>NEXT HOME · {stageName(goal().stage)}</span><p><strong>{days(goal().remainingDays)}</strong> to go</p><div class="gc-track" role="progressbar" aria-label="Days toward next home" aria-valuemin={0} aria-valuemax={goal().requiredDays} aria-valuenow={Math.min(ready().home.qualifiedDays, goal().requiredDays)} aria-valuetext={`${Math.min(ready().home.qualifiedDays, goal().requiredDays)} of ${goal().requiredDays} qualified days`}><i style={{ width: `${Math.min(100, ready().home.qualifiedDays / goal().requiredDays * 100)}%` }} /></div><small>{Math.min(ready().home.qualifiedDays, goal().requiredDays)} of {goal().requiredDays} days</small></>}
        </Show></div>
        <dl class="gc-streaks"><div><dt>Current streak</dt><dd>{days(ready().home.currentStreak)}</dd></div><div><dt>Best streak</dt><dd>{days(ready().home.bestStreak)}</dd></div></dl>
        <p class="gc-foot">A day counts after at least 10 minutes present.</p>
      </>}</Show>
    </div>
  </section>;
}

import { MONARCH_TITLES, arrivalLine, type ArrivalStanding, type MonarchTitle } from '@chatdom/shared/realm';
import './arrival-line.css';

/**
 * One calm worded line in the world's own lettering when a person arrives (Monarch.md §7.6): whose kingdom this is
 * and who they are in it. No box, no button to dismiss, no tutorial: it rises, holds and fades. The monarch's own
 * line carries their one choice, the title they are called by, as three quiet words.
 */
export interface ArrivalLineShow {
  readonly kingdom: string;
  readonly monarch: string | null;
  readonly standing: ArrivalStanding;
  /** "ahead", "to your left", … : where the castle stands from where you look. Guests and citizens only. */
  readonly castle?: string | null;
  /** The monarch's current title, for their own choice. */
  readonly title?: MonarchTitle;
  readonly choose?: (title: MonarchTitle) => void;
}

export const ARRIVAL_HOLD_MS = 6_500, MONARCH_HOLD_MS = 11_000;
const RISE_MS = 900, FADE_MS = 1_400;

/** Whether this person has already been greeted in this kingdom, in this standing, on this browser. */
export function arrivalKey(kingdomId: string, standing: ArrivalStanding): string { return `chatdom:arrival:${kingdomId}:${standing}`; }
export function firstArrival(storage: Pick<Storage, 'getItem'> | null, kingdomId: string, standing: ArrivalStanding): boolean {
  if (standing === 'monarch') return true;
  try { return storage?.getItem(arrivalKey(kingdomId, standing)) !== '1'; } catch { return true; }
}
export function rememberArrival(storage: Pick<Storage, 'setItem'> | null, kingdomId: string, standing: ArrivalStanding): void {
  if (standing === 'monarch') return;
  try { storage?.setItem(arrivalKey(kingdomId, standing), '1'); } catch { /* A private window greets again next time. */ }
}

/** Where a point stands relative to a view: ahead, to the left or right, or behind. Headings face (sin h, cos h). */
export function bearingWords(from: readonly [number, number], forward: readonly [number, number], to: readonly [number, number]): string {
  const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(forward[0], forward[1]) || 1;
  const fx = forward[0] / length, fz = forward[1] / length;
  // The right of a view along +Z is -X.
  const angle = Math.atan2(dx * -fz + dz * fx, dx * fx + dz * fz);
  const a = Math.abs(angle);
  return a < Math.PI / 5 ? 'ahead of you' : a > Math.PI * 4 / 5 ? 'behind you' : angle > 0 ? 'to your right' : 'to your left';
}

export function createArrivalLine(host: HTMLElement) {
  const root = document.createElement('div');
  root.className = 'monarch-arrival';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  host.appendChild(root);
  let timers: number[] = [], held = false, ending: (() => void) | null = null;
  const clear = () => { for (const timer of timers) clearTimeout(timer); timers = []; };
  root.addEventListener('pointerenter', () => { held = true; });
  root.addEventListener('pointerleave', () => { held = false; if (ending) { const end = ending; ending = null; end(); } });
  return {
    element: root,
    show(line: ArrivalLineShow) {
      clear(); held = false; ending = null;
      const words = arrivalLine({ kingdom: line.kingdom, monarch: line.monarch, standing: line.standing });
      root.replaceChildren();
      root.dataset.standing = line.standing;
      const place = document.createElement('p'); place.className = 'monarch-arrival-place'; place.textContent = words.place;
      const rule = document.createElement('i'); rule.className = 'monarch-arrival-rule'; rule.setAttribute('aria-hidden', 'true');
      const standing = document.createElement('p'); standing.className = 'monarch-arrival-standing';
      standing.textContent = line.castle && line.standing !== 'monarch' ? `${words.standing} · the castle stands ${line.castle}` : words.standing;
      root.append(place, rule, standing);
      if (line.standing === 'monarch' && line.choose) {
        const choice = document.createElement('p'); choice.className = 'monarch-arrival-titles';
        const label = document.createElement('span'); label.textContent = 'you are called';
        choice.append(label);
        for (const title of MONARCH_TITLES) {
          const button = document.createElement('button');
          button.type = 'button'; button.textContent = title;
          button.setAttribute('aria-pressed', String(title === line.title));
          button.addEventListener('click', () => {
            for (const other of choice.querySelectorAll('button')) other.setAttribute('aria-pressed', String(other === button));
            line.choose!(title);
          });
          choice.append(button);
        }
        root.append(choice);
      }
      root.classList.remove('leaving');
      root.classList.add('shown');
      const hold = line.standing === 'monarch' ? MONARCH_HOLD_MS : ARRIVAL_HOLD_MS;
      const leave = () => { root.classList.add('leaving'); timers.push(window.setTimeout(() => { root.classList.remove('shown', 'leaving'); root.replaceChildren(); }, FADE_MS)); };
      timers.push(window.setTimeout(() => { if (held) ending = leave; else leave(); }, RISE_MS + hold));
    },
    /** The monarch's title as the realm now holds it. */
    title(title: MonarchTitle) {
      for (const button of root.querySelectorAll<HTMLButtonElement>('.monarch-arrival-titles button')) button.setAttribute('aria-pressed', String(button.textContent === title));
    },
    get shown() { return root.classList.contains('shown'); },
    dispose() { clear(); root.remove(); },
  };
}
export type ArrivalLine = ReturnType<typeof createArrivalLine>;

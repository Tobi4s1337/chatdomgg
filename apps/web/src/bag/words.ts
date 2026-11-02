import type { ItemRecord } from '@chatdom/shared';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Weights read as a fisher would say them: "412 g", "2.14 kg". Never NaN, never a bare number. */
export function formatWeight(grams: number): string {
  if (!Number.isFinite(grams) || grams <= 0) return '';
  if (grams < 1000) return `${Math.round(grams)} g`;
  const kg = grams / 1000;
  return `${kg < 10 ? kg.toFixed(2) : kg.toFixed(1)} kg`;
}

export function formatLength(mm: number): string {
  if (!Number.isFinite(mm) || mm <= 0) return '';
  return mm < 1000 ? `${Math.round(mm / 10)} cm` : `${(mm / 1000).toFixed(2)} m`;
}

/** "2 November", in the kingdom's UTC day (the same day the server's story was written in). */
export function formatDay(at: number): string {
  if (!Number.isFinite(at)) return '';
  const date = new Date(at);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** Counts in words a person would use: "a perch", "3 perch"; never "1 items". */
export function formatCount(count: number, title: string): string {
  if (!Number.isInteger(count) || count < 1) return title;
  return count === 1 ? title : `${count} × ${title}`;
}

const PLACES: Record<ItemRecord['place'], string> = {
  worn: 'Worn', hand: 'In your hand', hotbar: 'On your belt', lot: 'At your home', shelf: 'On your shelf',
  bag: 'In your bag', away: 'Put away', spent: 'Used up',
};
export function formatPlace(place: ItemRecord['place']): string { return PLACES[place] ?? ''; }

/** The card's sentence of origin, from the server's story. "Caught by Juniper at Willowmere pier on 2 November." */
export function formatOrigin(item: Pick<ItemRecord, 'story' | 'source'>, viewerPersonId?: string): string {
  const { story } = item, day = formatDay(story.at);
  const who = story.by ? story.by.personId === viewerPersonId ? 'you' : story.by.name : null;
  const verb = item.source.kind === 'fishing' ? 'Caught' : item.source.kind === 'pier' ? 'Taken from the rack' : 'Found';
  const by = who && item.source.kind !== 'pier' ? ` by ${who}` : '';
  return `${verb}${by} at ${story.where}${day ? ` on ${day}` : ''}.`;
}

/** "17:42", in the same UTC day as `formatDay`. */
export function formatTime(at: number): string {
  if (!Number.isFinite(at)) return '';
  const date = new Date(at);
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

/** "2 November, 17:42". */
export function formatMoment(at: number): string {
  const day = formatDay(at), time = formatTime(at);
  return day && time ? `${day}, ${time}` : day;
}

/** Where a thing is now, with its belt or shelf place: "On your belt, slot 1". */
export function formatWhere(item: Pick<ItemRecord, 'place' | 'slot'>): string {
  const place = formatPlace(item.place);
  if (!place) return '';
  return (item.place === 'hotbar' || item.place === 'shelf') && Number.isInteger(item.slot) && item.slot! >= 0 ? `${place}, slot ${item.slot! + 1}` : place;
}

/** A tally in plain words: "12 caught", "3 gathered". Empty for a single thing. */
export function formatTally(count: number, caught: boolean): string {
  if (!Number.isInteger(count) || count < 2) return '';
  return `${count} ${caught ? 'caught' : 'gathered'}`;
}

/** "1 tool", "2 tools", "24 fish", "3 keepsakes". Never "1 items". */
export function formatKinds(parts: readonly { readonly count: number; readonly one: string; readonly many: string }[]): string {
  return parts.filter(part => Number.isInteger(part.count) && part.count > 0)
    .map(part => `${part.count} ${part.count === 1 ? part.one : part.many}`).join(' · ');
}

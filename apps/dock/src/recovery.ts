import { TokenSchema } from '@chatdom/shared';

/** Browser-local recovery records are partitioned by authenticated session and kingdom. */
export interface Recovery { uncertain: string; receipt: string }
interface Records { scope: string; kingdoms: Record<string, Recovery> }
const KEY = 'chatdom-dock-recovery-v1';
const LEGACY = 'chatdom-dock-uncertain';
const token = (value: string) => TokenSchema.safeParse(value).success;
const kingdomId = /^[1-9][0-9]{0,31}$/;
const empty = (): Recovery => ({ uncertain: '', receipt: '' });

export function bindRecovery(storage: Storage, scope: string): boolean {
  try {
    const raw = storage.getItem(KEY);
    let records: Records | undefined;
    if (raw) {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && 'scope' in value && 'kingdoms' in value
        && typeof value.scope === 'string' && value.kingdoms && typeof value.kingdoms === 'object' && !Array.isArray(value.kingdoms)) records = value as Records;
    }
    if (!records || records.scope !== scope) storage.setItem(KEY, JSON.stringify({ scope, kingdoms: {} }));
    return true;
  } catch { return false; }
}
export function readRecovery(storage: Storage, scope: string, kingdom: string): Recovery {
  try {
    if (!kingdomId.test(kingdom)) return empty();
    const records = JSON.parse(storage.getItem(KEY) ?? 'null') as Records | null;
    if (!records || records.scope !== scope) return empty();
    const value = records.kingdoms[kingdom];
    return { uncertain: typeof value?.uncertain === 'string' && token(value.uncertain) ? value.uncertain : '',
      receipt: typeof value?.receipt === 'string' && token(value.receipt) ? value.receipt : '' };
  } catch { return empty(); }
}
export function writeRecovery(storage: Storage, scope: string, kingdom: string, value: Recovery): boolean {
  try {
    if (!kingdomId.test(kingdom) || (value.uncertain && !token(value.uncertain)) || (value.receipt && !token(value.receipt))) return false;
    const records = JSON.parse(storage.getItem(KEY) ?? 'null') as Records | null;
    if (!records || records.scope !== scope) return false;
    records.kingdoms[kingdom] = value;
    storage.setItem(KEY, JSON.stringify(records));
    return true;
  } catch { return false; }
}
/** Carry an earlier unpartitioned uncertain intent forward conservatively on the first authenticated kingdom. */
export function migrateLegacy(storage: Storage, scope: string, kingdom: string): boolean {
  try {
    const legacy = storage.getItem(LEGACY);
    if (!legacy) return true;
    const current = readRecovery(storage, scope, kingdom);
    if (!token(legacy) || !writeRecovery(storage, scope, kingdom, { ...current, uncertain: current.uncertain || legacy })) return false;
    storage.removeItem(LEGACY);
    return true;
  } catch { return false; }
}
export function clearRecovery(storage: Storage): void {
  try { storage.removeItem(KEY); storage.removeItem(LEGACY); } catch { /* session has ended even if browser storage is unavailable */ }
}

/** Keep the requested numeric kingdom through sign-in, without requiring storage to view the dock. */
export function chooseKingdom(storage: Storage, requested: string | null): string | null {
  try {
    if (requested && kingdomId.test(requested)) storage.setItem('chatdom-dock-kingdom', requested);
    return requested ?? storage.getItem('chatdom-dock-kingdom');
  } catch { return requested; }
}
export function sameScope(session: { status: string; resumeScope?: string } | undefined, scope: string): boolean {
  return session?.status === 'authenticated' && session.resumeScope === scope;
}

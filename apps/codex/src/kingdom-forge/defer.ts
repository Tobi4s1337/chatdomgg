/** Server-only scheduling hint. JSON projection cannot turn it into an owner outcome or an authority grant. */
const deferred = Symbol('forge-authority-deferred');
export type ForgeAuthorityDeferReason = 'capacity' | 'unavailable';
export function deferForgeAuthority<T extends object>(value: T, reason: ForgeAuthorityDeferReason): T {
  return Object.defineProperty({ ...value }, deferred, { value: reason });
}
export function forgeAuthorityDeferred(value: unknown): boolean {
  return typeof value === 'object' && value !== null && deferred in value
    && (value[deferred] === 'capacity' || value[deferred] === 'unavailable');
}
/** Why an authority answer was deferred, if it was. `unavailable` means the kingdom wrote nothing for this step. */
export function forgeAuthorityDeferReason(value: unknown): ForgeAuthorityDeferReason | undefined {
  if (typeof value !== 'object' || value === null || !(deferred in value)) return undefined;
  const reason = value[deferred];
  return reason === 'capacity' || reason === 'unavailable' ? reason : undefined;
}

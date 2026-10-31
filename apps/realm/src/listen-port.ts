/** The local preview and realm must agree without a second, implicit port override. */
export function realmListenPort(env: Readonly<Record<string, string | undefined>>): number {
  let configured = env.REALM_PORT;
  if (configured === undefined && env.CHATDOM_REALM_TARGET) {
    try { configured = new URL(env.CHATDOM_REALM_TARGET).port; }
    catch { throw new Error('CHATDOM_REALM_TARGET must be a valid realm URL.'); }
  }
  const port = Number(configured ?? 5191);
  if (!Number.isInteger(port) || port < 5170 || port > 5199) {
    throw new Error('The realm needs a development port in 5170–5199 (REALM_PORT or CHATDOM_REALM_TARGET).');
  }
  return port;
}

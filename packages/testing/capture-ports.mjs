// Ports reserved for capture-owned servers. Service ports remain reserved even while empty.
export const CAPTURE_PORTS = Object.freeze([...Array.from({ length: 17 }, (_, i) => 5170 + i), 5188, 5189, 5198, 5199]);

export function assertCapturePort(port, { allowZero = false, name = 'Capture port' } = {}) {
  if (!(allowZero && port === 0) && !CAPTURE_PORTS.includes(port)) {
    throw new Error(`${name} must be a safe capture port${allowZero ? ' or 0' : ''}; reserved service ports are unavailable.`);
  }
  return port;
}

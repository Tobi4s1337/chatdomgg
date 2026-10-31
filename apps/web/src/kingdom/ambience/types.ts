/** Presentation weights from the installed terrain; never a presence or simulation authority. */
export interface AmbienceTarget {
  wind: number;
  water: number;
  /** Listener-relative shore direction, -1 left to +1 right. */
  waterPan: number;
}

import type { Vec3 } from '@chatdom/shared';

/** Presentation helper; callers supply accepted public people, never an invented occupancy count. */
export interface PeopleLightOptions {
  position: Vec3; near?: Vec3; reach: number; pilot?: number; full?: number;
  capacity?: number; rise?: number; fade?: number;
}
export interface PeopleLightSource { readonly position: Vec3; readonly strength: number }
export interface PeopleLight {
  /** Seconds. Repeated time is idempotent; backward seek resets to the instantaneous target. */
  update(time: number, people: readonly Vec3[]): number;
  source(): PeopleLightSource;
  /** Flush authority/history; restores zero, including any pilot. */
  clear(): void;
}

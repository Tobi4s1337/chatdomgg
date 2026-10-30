import { expect, it } from 'vitest';
import { beaconStrength } from './beacon';

const frame = (count: number) => ({ streamLive: true, connection: 'fresh' as const, windows: Array.from({length:count},(_,slot)=>({slot,present:true,publicName:null,since:0})) });
it('belongs to the live kingdom and grows with its people through the same feed seam',()=>{
  const quiet=beaconStrength(frame(0),240),one=beaconStrength(frame(1),240),crowd=beaconStrength(frame(180),240);
  expect(quiet).toBeGreaterThan(0);expect(quiet).toBeLessThan(.25);
  expect(one).toBeGreaterThan(quiet);expect(crowd).toBeGreaterThan(one);
  expect(beaconStrength(frame(240),240)).toBe(1);
  expect(beaconStrength(frame(300),240)).toBe(1);
  expect(beaconStrength({...frame(240),connection:'stale'},240)).toBe(0);
  expect(beaconStrength({...frame(0),streamLive:false,connection:'offline'},240)).toBe(0);
  expect(beaconStrength(undefined,240)).toBe(0);
  expect(beaconStrength(frame(1),0)).toBe(0);
});

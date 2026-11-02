import { describe, expect, it } from 'vitest';
import { chooseHeroPlan, rendererTier, stepDown, type HeroEnvironment } from './policy';

const desktop: HeroEnvironment = { renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 5080 Direct3D11 vs_5_0 ps_5_0, D3D11)', reducedMotion: false, saveData: false,
  memory: 8, cores: 16, coarse: false, shortSide: 1440, override: null };

describe('the hero plan', () => {
  it('draws the live land on a desktop with a real GPU', () => {
    expect(chooseHeroPlan(desktop)).toEqual({ kind: 'live', tier: 'high', reason: 'desktop' });
  });

  it('keeps the pictures without WebGL2, on a software renderer, with reduced motion or when saving data', () => {
    expect(chooseHeroPlan({ ...desktop, renderer: null })).toMatchObject({ kind: 'still', reason: 'no WebGL2' });
    expect(chooseHeroPlan({ ...desktop, renderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' })).toMatchObject({ kind: 'still', reason: 'software renderer' });
    expect(chooseHeroPlan({ ...desktop, renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toMatchObject({ kind: 'still' });
    expect(chooseHeroPlan({ ...desktop, reducedMotion: true })).toMatchObject({ kind: 'still', reason: 'reduced motion' });
    expect(chooseHeroPlan({ ...desktop, saveData: true })).toMatchObject({ kind: 'still', reason: 'saving data' });
  });

  it('keeps the pictures on weak devices and phones', () => {
    expect(chooseHeroPlan({ ...desktop, cores: 2 })).toMatchObject({ kind: 'still' });
    expect(chooseHeroPlan({ ...desktop, memory: 2 })).toMatchObject({ kind: 'still' });
    expect(chooseHeroPlan({ ...desktop, renderer: 'Apple GPU', coarse: true, shortSide: 390, memory: null, cores: 6 })).toMatchObject({ kind: 'still', reason: 'phone' });
    expect(chooseHeroPlan({ ...desktop, renderer: 'Adreno (TM) 740', coarse: true, shortSide: 412 })).toMatchObject({ kind: 'still', reason: 'phone' });
  });

  it('steps a tier down for large touch screens and for 4 GB machines', () => {
    expect(chooseHeroPlan({ ...desktop, renderer: 'Apple GPU', coarse: true, shortSide: 1024, memory: null })).toEqual({ kind: 'live', tier: 'medium', reason: 'large touch screen' });
    expect(chooseHeroPlan({ ...desktop, memory: 4 })).toMatchObject({ kind: 'live', tier: 'medium' });
  });

  it('gives laptops with integrated graphics the medium tier, unknown renderers the low one', () => {
    expect(chooseHeroPlan({ ...desktop, renderer: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)' })).toMatchObject({ kind: 'live', tier: 'medium' });
    expect(chooseHeroPlan({ ...desktop, renderer: 'Some Future GPU' })).toMatchObject({ kind: 'live', tier: 'low' });
  });

  it('honours a stored choice, so captures can ask for either', () => {
    expect(chooseHeroPlan({ ...desktop, override: 'still' })).toMatchObject({ kind: 'still' });
    expect(chooseHeroPlan({ ...desktop, renderer: 'SwiftShader', override: 'live' })).toEqual({ kind: 'live', tier: 'software', reason: 'asked for the live land' });
    expect(chooseHeroPlan({ ...desktop, renderer: null, override: 'live' })).toMatchObject({ kind: 'still' });
  });

  it('names renderers and steps down', () => {
    expect(rendererTier('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro, Unspecified Version)')).toBe('high');
    expect(rendererTier('ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('high');
    expect(rendererTier('Mali-G78')).toBe('medium');
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('low')).toBeNull();
  });
});

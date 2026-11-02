import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createVoxelMaterial } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content';
import { MaterialRegistrySchema } from '@chatdom/shared';
import { grandPalette } from '../../../../../packages/world/src/grand/palette';
import { createHostedGrandMaterial, hostedFragment, hostedPalette, HOSTED_PAVING } from './material';

describe('the hosted grand material', () => {
  const palette = grandPalette({ stone: 'sandstone', grass: 'summer', hueDrift: 0, autumn: .5 });
  it('retains grand IDs in its own valid palette and an explicit paved material', () => {
    const registry = MaterialRegistrySchema.parse(hostedPalette(palette));
    expect(registry.materials.find(m => m.id === HOSTED_PAVING)?.surface).toBe('stone');
    for (const material of palette) expect(registry.materials.find(m => m.id === material.id)?.colour).toBe(material.colour);
  });
  it('shares the native grade, fields, beacon and Forge light without flattening real geometry', () => {
    const native = createVoxelMaterial(MATERIALS, 'terrain'), hosted = createHostedGrandMaterial(palette, native);
    for (const key of ['uSun', 'uSunDirection', 'uAmbient', 'uLight', 'uFarLight', 'uBeaconLight', 'uSmithyPower'])
      expect(hosted.material.uniforms[key]).toBe(native.material.uniforms[key]);
    expect(hosted.material.uniforms.uPalette).not.toBe(native.material.uniforms.uPalette);
    expect(hosted.material.vertexShader).toContain('in uvec2 aQuad;');
    expect(hosted.material.vertexShader).not.toContain('groundHeight(');
    expect(hosted.material.vertexShader).not.toContain('uniform mat4 modelMatrix');
    expect(hosted.material.vertexShader).toContain('out float vSky; out float vLodFade;');
    // The only differences are the side faces' sky fill, so grading steps do not read as dark seams,
    expect(hosted.material.fragmentShader).not.toBe(native.material.fragmentShader);
    // the night settling of the grass, which is the identity at night 0, and the town's turf, which is the
    // identity outside the installed region (hostedTurf 0 leaves the normal and the occlusion as they were).
    const turf = hosted.material.fragmentShader.match(/\n {6}float hostedEdge=[^\n]*/)![0];
    expect(turf).toContain('uHostedTown');
    // The town's land use tints only grass tops inside its mask; with no mask its rectangle lies far from any town.
    const use = hosted.material.fragmentShader.match(/\n {6}if\(kind==2\.&&n\.y>\.5\)\{vec2 useUv[^\n]*/)![0];
    expect(use).toContain('uTownUseLook[useCode]');
    expect(hosted.material.uniforms.uTownUseRect!.value.x).toBe(1e9);
    // Turf and paving ease out over 16 m; rock and soil banks only strictly inside the region, so the crag's
    // faces outside it keep their relief.
    expect(turf).toContain('float hostedTurf=kind==2.||kind==3.?1.-smoothstep(0.,16.,hostedEdge):kind==1.?1.-smoothstep(-1.,0.,hostedEdge):0.;');
    expect(hosted.material.fragmentShader.replace('float facing=n.y<-.5?.5:.74+.26*max(n.y,0.);', 'float facing=.5+.5*max(n.y,0.);')
      .replace('\n      if(kind==2.)base*=mix(vec3(1.),vec3(.55,.52,.95),uNight);', '').replace(turf, '')
      .replace('float ao=mix(.49,1.,mix(vAo,mix(.8,1.,vAo),hostedTurf));', 'float ao=mix(.49,1.,vAo);')
      .replace(use, '')
      .replace('uniform vec4 uHostedTown;uniform vec4 uTownUseRect;uniform vec4 uTownUseLook[16];uniform sampler2D uTownUse;\n', '')).toBe(native.material.fragmentShader);
    expect(() => hostedFragment('void main(){}')).toThrow(/facing/);
    hosted.dispose(); native.dispose();
  });
  it('limits the town turf to the installed region, and is inert without one', () => {
    const native = createVoxelMaterial(MATERIALS, 'terrain');
    const town = createHostedGrandMaterial(palette, native, { minX: -192, maxX: 272, minZ: -112, maxZ: 304 });
    expect(town.material.uniforms.uHostedTown!.value.toArray()).toEqual([-192, 272, -112, 304]);
    // Without a region the box is empty: every point lies at least 1e9 m outside it, far past the 16 m ease.
    const none = createHostedGrandMaterial(palette, native);
    expect(none.material.uniforms.uHostedTown!.value.toArray()).toEqual([1e9, -1e9, 1e9, -1e9]);
    expect(() => createHostedGrandMaterial(palette, native, { minX: 10, maxX: 10, minZ: 0, maxZ: 1 })).toThrow(/installed region/);
    expect(() => createHostedGrandMaterial(palette, native, { minX: 0, maxX: Number.NaN, minZ: 0, maxZ: 1 })).toThrow(/installed region/);
    town.dispose(); none.dispose(); native.dispose();
  });
  it('uploads each mesh fade independently when a material is shared', () => {
    const native = createVoxelMaterial(MATERIALS, 'terrain'), hosted = createHostedGrandMaterial(palette, native);
    const first = new THREE.Mesh(), second = new THREE.Mesh();
    let calls = 0;
    first.onBeforeRender = () => { calls++; };
    hosted.bindFade(first); hosted.bindFade(first); hosted.bindFade(second);
    first.userData.grandLodFade = -1.4;
    const render = (mesh: THREE.Mesh, material: THREE.Material) => mesh.onBeforeRender(
      null as unknown as THREE.WebGLRenderer, new THREE.Scene(), new THREE.Camera(), mesh.geometry, material, null as unknown as THREE.Group,
    );
    render(first, hosted.material);
    expect(hosted.material.uniforms.uGrandLodFade!.value).toBe(-1.4);
    expect(hosted.material.uniformsNeedUpdate).toBe(true);
    render(second, hosted.material);
    expect(hosted.material.uniforms.uGrandLodFade!.value).toBe(1);
    render(first, new THREE.MeshBasicMaterial());
    expect(hosted.material.uniforms.uGrandLodFade!.value).toBe(1);
    expect(calls).toBe(2);
    first.geometry.dispose(); second.geometry.dispose(); hosted.dispose(); native.dispose();
  });
});

describe('the town land use on the hosted floor', () => {
  it('uploads one code and row byte per metre and the looks of its codes', () => {
    const native = createVoxelMaterial(MATERIALS, 'terrain');
    const data = Uint8Array.from([0, 1, 2, 0, 3, 0]), rows = Uint8Array.from([0, 64, 128, 0, 0, 0]);
    const hosted = createHostedGrandMaterial([], native, { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
      { origin: [-3, -2], width: 3, depth: 2, data, rows, look: { 1: { tint: '#c9a24a', rows: .35 }, 3: { tint: '#7a5a3a', rows: .5 } } });
    const texture = hosted.material.uniforms.uTownUse!.value as THREE.DataTexture;
    expect([texture.image.width, texture.image.height]).toEqual([3, 2]);
    expect([...(texture.image.data as Uint8Array)]).toEqual([0, 0, 1, 64, 2, 128, 0, 0, 3, 0, 0, 0]);
    expect(texture.magFilter).toBe(THREE.NearestFilter);
    expect(hosted.material.uniforms.uTownUseRect!.value.toArray()).toEqual([-3, -2, 3, 2]);
    const look = hosted.material.uniforms.uTownUseLook!.value as THREE.Vector4[];
    expect(look[1]!.w).toBe(.35);
    expect(look[2]!.toArray()).toEqual([0, 0, 0, 0]);
    expect(() => createHostedGrandMaterial([], native, undefined, { origin: [0, 0], width: 2, depth: 2, data, rows, look: {} })).toThrow(/one code/);
    expect(() => createHostedGrandMaterial([], native, undefined, { origin: [0, 0], width: 3, depth: 2, data, rows, look: { 16: { tint: '#000', rows: 0 } } })).toThrow(/sixteen/);
    hosted.dispose(); native.dispose();
  });

  it('lays the land use on a floor made before it was planned', () => {
    const native = createVoxelMaterial(MATERIALS, 'terrain');
    const hosted = createHostedGrandMaterial([], native, { minX: -10, maxX: 10, minZ: -10, maxZ: 10 });
    expect(hosted.material.uniforms.uTownUseRect!.value.x).toBe(1e9);
    hosted.setTownUse({ origin: [-3, -2], width: 3, depth: 2, data: Uint8Array.from([0, 4, 0, 0, 0, 9]), rows: new Uint8Array(6), look: { 4: { tint: '#d6b05c', rows: .35 } } });
    const texture = hosted.material.uniforms.uTownUse!.value as THREE.DataTexture;
    expect([texture.image.width, texture.image.height]).toEqual([3, 2]);
    expect(hosted.material.uniforms.uTownUseRect!.value.toArray()).toEqual([-3, -2, 3, 2]);
    expect((hosted.material.uniforms.uTownUseLook!.value as THREE.Vector4[])[4]!.w).toBe(.35);
    hosted.dispose(); native.dispose();
  });
});

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
    // Turf and paving ease out over 16 m; rock and soil banks only strictly inside the region, so the crag's
    // faces outside it keep their relief.
    expect(turf).toContain('float hostedTurf=kind==2.||kind==3.?1.-smoothstep(0.,16.,hostedEdge):kind==1.?1.-smoothstep(-1.,0.,hostedEdge):0.;');
    expect(hosted.material.fragmentShader.replace('float facing=n.y<-.5?.5:.74+.26*max(n.y,0.);', 'float facing=.5+.5*max(n.y,0.);')
      .replace('\n      if(kind==2.)base*=mix(vec3(1.),vec3(.55,.52,.95),uNight);', '').replace(turf, '')
      .replace('float ao=mix(.49,1.,mix(vAo,mix(.8,1.,vAo),hostedTurf));', 'float ao=mix(.49,1.,vAo);')
      .replace('uniform vec4 uHostedTown;\n', '')).toBe(native.material.fragmentShader);
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

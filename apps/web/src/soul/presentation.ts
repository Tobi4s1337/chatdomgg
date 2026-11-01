import * as THREE from 'three';
import type { SoulFrame, SoulRole, SoulTopology, SoulPoint } from '../../../../packages/world/src/soul';

export interface SoulPresentationOptions { topology: SoulTopology; chimney?: SoulPoint | undefined }
export interface SoulWeatherSurfaceOptions { roofs: readonly THREE.MeshStandardMaterial[]; snow: readonly THREE.Object3D[]; puddles: readonly THREE.Object3D[] }
/** Modify caller-owned surfaces reversibly; caller supplies actual roof and precipitation geometry. */
export function createSoulWeatherSurfaces(options: SoulWeatherSurfaceOptions) {
  const roofs=options.roofs.map(material=>({material,color:material.color.clone(),roughness:material.roughness}));
  const snapshot=(objects: readonly THREE.Object3D[]) => objects.map(object=>({object,visible:object.visible,materials:(object instanceof THREE.Mesh ? (Array.isArray(object.material)?object.material:[object.material]) : []).map(material=>({material,opacity:material.opacity,transparent:material.transparent}))}));
  const snow=snapshot(options.snow), puddles=snapshot(options.puddles);
  const amount=(items:typeof snow, value:number)=>{for(const item of items){item.object.visible=item.visible && value>.001;for(const m of item.materials){if(!m.material.transparent){m.material.transparent=true;m.material.needsUpdate=true;}m.material.opacity=m.opacity*Math.min(1,value*2);}}};
  return {
    update(frame: SoulFrame) { for(const roof of roofs){roof.material.color.copy(roof.color).multiplyScalar(1-frame.weather.wetness*.32);roof.material.roughness=roof.roughness*(1-frame.weather.wetness*.48);}amount(snow,frame.weather.snowCover);amount(puddles,frame.weather.wetness); },
    dispose() { for(const roof of roofs){roof.material.color.copy(roof.color);roof.material.roughness=roof.roughness;}for(const item of [...snow,...puddles]){item.object.visible=item.visible;for(const m of item.materials){m.material.opacity=m.opacity;if(m.material.transparent!==m.transparent){m.material.transparent=m.transparent;m.material.needsUpdate=true;}}} }
  };
}
/** Scene-owned, bounded presentation. Caller supplies its actual street topology and chimney. */
export function createSoulPresentation(scene: THREE.Scene, options: SoulPresentationOptions) {
  if(options.topology.lamps.length>64) throw new RangeError('Soul presentation supports at most 64 lamps per district');
  const root = new THREE.Group(); scene.add(root);
  const points=Object.values(options.topology.routes).flatMap(route=>route ?? []); const centre=points.length ? points.reduce((v,p)=>v.add(new THREE.Vector3(...p)),new THREE.Vector3()).multiplyScalar(1/points.length) : new THREE.Vector3();
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [];
  const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: .88, ...extra }); materials.push(m); return m; };
  const box = new THREE.BoxGeometry(1, 1, 1); geometries.push(box);
  const wood = mat('#5d493d'), skin = mat('#d7a77c'), eyes = mat('#302923'), bread = mat('#c99555'), coats = [mat('#9e6248'), mat('#4f6971'), mat('#73594e'), mat('#788264')];
  const gold = mat('#e3ae60', { emissive: '#a25720', emissiveIntensity: .6 });
  const mesh = (parent: THREE.Object3D, material: THREE.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => { const m = new THREE.Mesh(box, material); m.position.set(x,y,z); m.scale.set(sx,sy,sz); parent.add(m); return m; };
  const keepers = new Map<SoulRole, THREE.Group>();
  const limbs = new Map<SoulRole, { left: THREE.Group; right: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group }>();
  (['baker','lamplighter','smith','harbour-master'] as const).forEach((role,i) => {
    const g = new THREE.Group(); root.add(g); keepers.set(role,g);
    mesh(g,coats[i]!,0,.65,0,.65,.8,.45); mesh(g,skin,0,1.35,0,.7,.7,.65);
    mesh(g,wood,0,1.74,0,.78,.13,.72);
    mesh(g,eyes,-.18,1.4,.33,.09,.1,.04);mesh(g,eyes,.18,1.4,.33,.09,.1,.04);
    const left=new THREE.Group(),right=new THREE.Group(),leftArm=new THREE.Group(),rightArm=new THREE.Group();
    left.position.set(-.19,.4,0);right.position.set(.19,.4,0);leftArm.position.set(-.39,.94,0);rightArm.position.set(.39,.94,0);g.add(left,right,leftArm,rightArm);
    mesh(left,wood,0,-.2,0,.23,.4,.27);mesh(right,wood,0,-.2,0,.23,.4,.27);mesh(leftArm,coats[i]!,0,-.22,0,.2,.45,.22);mesh(rightArm,coats[i]!,0,-.22,0,.2,.45,.22);limbs.set(role,{left,right,leftArm,rightArm});
    if(role==='baker'){mesh(g,skin,0,1.88,0,.6,.2,.58);mesh(g,skin,0,.7,.25,.44,.58,.05);}
    if(role==='smith'){mesh(rightArm,wood,.08,-.55,0,.1,.55,.1);mesh(rightArm,wood,.08,-.8,0,.38,.18,.18);}
    if(role==='lamplighter')mesh(g,gold,.55,.7,0,.25,.3,.25);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const ctx=canvas.getContext('2d')!;ctx.font='bold 24px Georgia';ctx.textAlign='center';ctx.fillStyle='#342c26';ctx.fillRect(12,8,232,48);ctx.strokeStyle='#d1ac72';ctx.strokeRect(12,8,232,48);ctx.fillStyle='#f6e4c2';ctx.fillText(role==='harbour-master'?'Harbour master':role[0]!.toUpperCase()+role.slice(1),128,40);const texture=new THREE.CanvasTexture(canvas);const labelMat=new THREE.SpriteMaterial({map:texture,depthTest:false});materials.push(labelMat);const label=new THREE.Sprite(labelMat);label.position.set(0,2.3,0);label.scale.set(2,.5,1);g.add(label);

  });
  // A district costs two draws regardless of its lamp count. Positions are fixed by topology.
  const lampCount=options.topology.lamps.length;
  const lampPosts=new THREE.InstancedMesh(box,wood,lampCount), lampGlass=new THREE.InstancedMesh(box,gold,lampCount);
  // Glass grows from a zero-scale unlit instance; a cached zero-radius bound would clip first light.
  lampGlass.frustumCulled=false;
  root.add(lampPosts,lampGlass);
  const lampMatrix=new THREE.Matrix4(), lampPosition=new THREE.Vector3(), lampScale=new THREE.Vector3(), lampRotation=new THREE.Quaternion();
  const lampStates=Array<boolean | undefined>(lampCount).fill(undefined);
  options.topology.lamps.forEach((lamp,i)=>{lampPosition.set(lamp.position[0],lamp.position[1]+1,lamp.position[2]);lampScale.set(.12,2,.12);lampMatrix.compose(lampPosition,lampRotation,lampScale);lampPosts.setMatrixAt(i,lampMatrix);});
  lampPosts.instanceMatrix.needsUpdate=true;

  const cart = new THREE.Group(); root.add(cart); mesh(cart,wood,0,.4,0,1,.3,.65); mesh(cart,wood,-.35,.2,.38,.25,.4,.12); mesh(cart,wood,.35,.2,.38,.25,.4,.12); mesh(cart,bread,-.25,.65,-.08,.3,.19,.3);mesh(cart,bread,.1,.65,-.08,.3,.19,.3);mesh(cart,bread,-.08,.68,.2,.3,.19,.28);
  // Feather the valley haze to nothing at its edges; a flat alpha rectangle reads as a platform.
  const mistPixels = new Uint8Array(32 * 32 * 4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){
    const at=(x+y*32)*4, radius=((x-15.5)/15.5)**2+((y-15.5)/15.5)**2;
    mistPixels[at]=mistPixels[at+1]=mistPixels[at+2]=255;
    mistPixels[at+3]=Math.round(255*Math.max(0,1-radius)**2);
  }
  const mistTexture=new THREE.DataTexture(mistPixels,32,32);mistTexture.magFilter=THREE.LinearFilter;mistTexture.minFilter=THREE.LinearFilter;mistTexture.needsUpdate=true;
  const mistMat = new THREE.MeshBasicMaterial({color:'#e9e4d1',map:mistTexture,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide}); materials.push(mistMat);
  const mistGeo = new THREE.PlaneGeometry(36,20); geometries.push(mistGeo); const mist = new THREE.Mesh(mistGeo,mistMat); mist.rotation.x=-Math.PI/2; mist.position.set(centre.x,centre.y+.4,centre.z); root.add(mist);
  const smokeMat = new THREE.MeshBasicMaterial({color:'#ddd4c1',transparent:true,opacity:.25,depthWrite:false}); materials.push(smokeMat);
  const smokeGeo = new THREE.SphereGeometry(.28,6,4); geometries.push(smokeGeo); const smoke = new THREE.InstancedMesh(smokeGeo,smokeMat,8); root.add(smoke); const smokeMatrix=new THREE.Matrix4(), smokePosition=new THREE.Vector3(), smokeScale=new THREE.Vector3(), smokeRotation=new THREE.Quaternion();
  const precipitationGeo = new THREE.BufferGeometry(); geometries.push(precipitationGeo); const drops = new Float32Array(450*3); for(let i=0;i<450;i++){drops[i*3]=((i*73)%397)/11-18; drops[i*3+1]=((i*47)%137)/11; drops[i*3+2]=((i*101)%359)/10-18;} precipitationGeo.setAttribute('position',new THREE.BufferAttribute(drops,3));
  const rainMat = new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{time:{value:0},opacity:{value:0},size:{value:3},speed:{value:3}},vertexShader:`uniform float time; uniform float size; uniform float speed; void main(){vec3 p=position; p.y=mod(p.y-time*speed+1200.0,12.0); gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0); gl_PointSize=size;}`,fragmentShader:`uniform float opacity; void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(.78,.86,.89,opacity*(1.0-smoothstep(.15,.5,d)));}`}); materials.push(rainMat); const rain=new THREE.Points(precipitationGeo,rainMat); rain.position.copy(centre); root.add(rain);

  return {
    update(frame: SoulFrame, seconds: number) {
      for (const [role,g] of keepers) { const k=frame.keepers.find(k=>k.role===role); g.visible=!!k && k.visible; if(k){g.position.set(...k.position); g.rotation.y=k.heading; const limb=limbs.get(role)!;const stride=k.moving?Math.sin(seconds*4.4)*.48:0;limb.left.rotation.x=stride;limb.right.rotation.x=-stride;limb.leftArm.rotation.x=-stride*.7;limb.rightArm.rotation.x=stride*.7+(role==='smith' && k.activity==='working at the forge'?Math.sin(seconds*2)*.16:0);} }
      for(let i=0;i<lampCount;i++){const l=frame.lamps[i];const lit=!!l?.lit;if(lampStates[i]===lit)continue;lampStates[i]=lit;const anchor=options.topology.lamps[i]!.position;lampPosition.set(anchor[0],anchor[1]+2.1,anchor[2]);lampScale.setScalar(lit ? .37 : 0);if(lit)lampScale.y=.4;lampMatrix.compose(lampPosition,lampRotation,lampScale);lampGlass.setMatrixAt(i,lampMatrix);lampGlass.instanceMatrix.needsUpdate=true;}
      cart.visible=frame.breadCart.visible; cart.position.set(...frame.breadCart.position); const baker=frame.keepers.find(k=>k.role==='baker');if(baker){cart.position.x-=Math.sin(baker.heading)*1.1;cart.position.z-=Math.cos(baker.heading)*1.1;cart.rotation.y=baker.heading;}
      smoke.visible=!!options.chimney && frame.chimneySmoke>.01; for(let i=0;i<8;i++){const age=(seconds*.3+i/8)%1;smokePosition.set((options.chimney?.[0]??0)+age*.8,(options.chimney?.[1]??0)+age*3,options.chimney?.[2]??0);smokeScale.setScalar(.5+age*1.5);smokeMatrix.compose(smokePosition,smokeRotation,smokeScale);smoke.setMatrixAt(i,smokeMatrix);}smoke.instanceMatrix.needsUpdate=true;smokeMat.opacity=frame.chimneySmoke*.22;
      mistMat.opacity=frame.weather.fog*.27; mist.position.x=centre.x+Math.sin(seconds*.025)*1.2;
      rainMat.uniforms.opacity!.value=Math.max(frame.weather.rain,frame.weather.snow)*.8; rainMat.uniforms.size!.value=frame.weather.snow>.1?5:2; rainMat.uniforms.speed!.value=frame.weather.snow>.1?.4:3; rainMat.uniforms.time!.value=seconds;
    },
    dispose(){ scene.remove(root); mistTexture.dispose(); smoke.dispose(); lampPosts.dispose(); lampGlass.dispose(); geometries.forEach(g=>g.dispose()); materials.forEach(m=>{if(m instanceof THREE.SpriteMaterial)m.map?.dispose();m.dispose();}); }
  };
}

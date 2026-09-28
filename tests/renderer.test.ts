import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createCanvas, loadImage, Image } from '@napi-rs/canvas';
import { clientLayers, renderClientPose, type Outfit } from '../src/compositor';
import { TYPES, PROFILES, defaultRig, type ItemDef, type Project } from '../src/model';
import { extractStrip, renderPart, generatePoses, shieldPoses, stripSource } from '../src/artwork';
import { nativeBundle, nextSpriteId } from '../src/export';
import { copyAtlasWithSlot } from '../src/carbon';
import { validateAppearance, validateDefs, readProjectFiles } from '../src/library';
import { parseProject } from '../src/project';

(globalThis as any).document = { createElement: () => createCanvas(1, 1) };
(globalThis as any).Image = Image;
const entries = JSON.parse(await readFile('public/game/appearance.carbon', 'utf8'));
const defs: ItemDef[] = JSON.parse(await readFile('public/game/itemdefs.carbon', 'utf8'));
const images: Map<string, any> = new Map(await Promise.all(entries.map(async (e: any) => [e.filename, await loadImage(e.data)])));
const pixels = (c: any) => Buffer.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data);
const oracleCanvas = createCanvas(960,128), actual = createCanvas(960,128), frame = createCanvas(64,128);
const workerErrors: unknown[] = [];
const self: any = { postMessage() {} };
vm.runInNewContext(await readFile('tests/fixtures/client-worker.js', 'utf8'), { self, console: { error: (...e: unknown[]) => workerErrors.push(e) }, requestAnimationFrame: (fn: Function) => fn() });
const keys = { hair1Bitmap:'hair.png', beard1Bitmap:'beard.png', body1Bitmap:'body.png', shirt1Bitmap:'shirt.png', pants1Bitmap:'pants.png', helmet1Bitmap:'helmet1.png', helmetBack1Bitmap:'helmet_back1.png', chest1Bitmap:'chest1.png', legs1Bitmap:'legs1.png', shieldBack1Bitmap:'shield_back1.png', shieldFront1Bitmap:'shield_front1.png', weapon1Bitmap:'weapon1.png', backFront1Bitmap:'cape_front1.png', backBack1Bitmap:'cape_back1.png', neck1Bitmap:'neck1.png', gloves1Bitmap:'gloves1.png', boots1Bitmap:'boots1.png', helmetTrim1Bitmap:'helmettrim1.png', chestTrim1Bitmap:'chesttrim1.png', legsTrim1Bitmap:'legstrim1.png', shieldTrimBack1Bitmap:'shieldtrim_back1.png', shieldTrimFront1Bitmap:'shieldtrim_front1.png' };
await self.onmessage({ data: { type: 'initialize', canvas: oracleCanvas, ...Object.fromEntries(Object.entries(keys).map(([k,v]) => [k, images.get(v)])) } });
async function compare(outfit: Outfit, context: string) {
  const slots = ['helmet','chest','legs','shield','weapon','back','neck','gloves','boots','projectile'] as const;
  const equippedItemIds = slots.map(slot => { const d = outfit[slot]; return d ? [d.equipmentSpriteSheet ? Number(d.equipmentSpriteSheet.slice(-1))-1 : -1, d.equipmentSpriteId ?? -1, d._id, d.equipmentTrimSpriteSheet ? Number(d.equipmentTrimSpriteSheet.slice(-1))-1 : -1, d.equipmentTrimSpriteId ?? -1] : [-1,-1,-1,-1,-1]; });
  await self.onmessage({ data: { type:'create', appearanceIds: [[0,1],[0,1],[0,0],[0,0],[0,0]], equippedItemIds, doesHelmetHideSpritesUnderneath: !!outfit.helmet?.hidesSpritesUnderneath, doesChestHideSpritesUnderneath: !!outfit.chest?.hidesSpritesUnderneath, doLegsHideSpritesUnderneath: !!outfit.legs?.hidesSpritesUnderneath, opacity: 1, filter: 0 } });
  const ctx = actual.getContext('2d'); ctx.clearRect(0,0,960,128);
  const layers = clientLayers(outfit);
  for (let p = 0; p < 15; p++) { renderClientPose(frame.getContext('2d') as any, p, layers, images); ctx.drawImage(frame, p*64, 0); }
  assert.equal(Buffer.compare(pixels(actual), pixels(oracleCanvas)), 0, context);
  assert.equal(workerErrors.length, 0, `Reference worker errors: ${workerErrors}`);
}

test('all equipped definitions match the unmodified client worker across all 15 frames', async () => {
  await compare({}, 'bare mannequin');
  let count = 0;
  for (const d of defs.filter(d => TYPES.includes(d.equipmentType!))) { await compare({ [d.equipmentType!]: d }, `${d.equipmentType}: ${d.name} #${d._id}`); count++; }
  console.log(`Compared ${count} items × 15 frames against upstream worker.`);
});
test('every chest/glove and leg/boot pair matches client overlap, with full outfits', async () => {
  const items = (type: string) => defs.filter(d => d.equipmentType === type);
  let count = 0;
  for (const chest of items('chest')) for (const gloves of items('gloves')) { await compare({ chest, gloves }, `chest ${chest._id}, gloves ${gloves._id}`); count++; }
  for (const legs of items('legs')) for (const boots of items('boots')) { await compare({ legs, boots }, `legs ${legs._id}, boots ${boots._id}`); count++; }
  for (let i=0;i<90;i++) { const outfit: Outfit = {}; for (const slot of TYPES) { const list = items(slot); outfit[slot] = list[i % list.length]; } await compare(outfit, `full outfit ${i}`); count++; }
  console.log(`Compared ${count} mixed outfits × 15 frames against upstream worker.`);
});
test('all template layers extract and repack with identical decoded pixels', async () => {
  let count = 0;
  const seen = new Set<string>();
  for (const d of defs.filter(d => ['helmet','legs','back','shield'].includes(d.equipmentType!))) {
    for (const part of PROFILES[d.equipmentType!].parts) {
      if (part.special && d._id !== 617) continue;
      const id = part.special ? 0 : part.trim ? d.equipmentTrimSpriteId : d.equipmentSpriteId;
      if (id == null || id < 0) continue;
      const key = `${part.atlas}:${id}`; if (seen.has(key)) continue; seen.add(key);
      const atlas = images.get(part.atlas), frames = PROFILES[d.equipmentType!].frames;
      const strip = extractStrip(atlas, frames, id), packed = copyAtlasWithSlot(atlas, strip as any, frames, id);
      const before = createCanvas(atlas.width,atlas.height); before.getContext('2d').drawImage(atlas,0,0);
      assert.equal(Buffer.compare(pixels(before), pixels(packed)),0,key); count++;
    }
  }
  console.log(`Round-tripped ${count} distinct native layers with identical decoded artwork.`);
});
test('cells wrap across atlas rows; transparent replacement clears old pixels without touching neighbors', () => {
  const atlas = createCanvas(7*64,5*128), ctx = atlas.getContext('2d');
  for(let i=0;i<35;i++) { ctx.fillStyle = `rgb(${i*7},${255-i*5},50)`; ctx.fillRect(i%7*64,Math.floor(i/7)*128,64,128); }
  const strip = extractStrip(atlas as any,15,1); assert.equal(pixels(strip)[0],15*7);
  const blank = createCanvas(960,128), replaced = copyAtlasWithSlot(atlas as any,blank as any,15,1);
  const data = replaced.getContext('2d')!;
  for(let i=0;i<35;i++) assert.equal(data.getImageData(i%7*64,Math.floor(i/7)*128,1,1).data[3], i>=15&&i<30 ? 0 : 255);
  assert.throws(() => extractStrip(atlas as any,15,2),/complete cells/);
});
test('native export allocates paired IDs beyond artwork and references; trims allocate separately; full bundle retained', async () => {
  const original = [...entries, {filename:'unrelated.bin',data:'untouched'}];
  const d = defs.find(d => d.equipmentType==='shield' && (d.equipmentTrimSpriteId??-1)>=0)!;
  const project: Project = {version:3,definition:{...d,_id:9000,name:'Test shield',customField:{keep:true}},sourceParts:{},autoRig:defaultRig(),replaceExisting:false};
  const strips = new Map<any,any>();
  for(const p of PROFILES.shield.parts) strips.set(p.key,extractStrip(images.get(p.atlas),15,(p.trim?d.equipmentTrimSpriteId:d.equipmentSpriteId)!));
  const referenced = [...defs,{...d,_id:9001,equipmentSpriteId:80,equipmentTrimSpriteId:100}];
  const result = await nativeBundle(project,strips,original,images,referenced);
  assert.equal(result.definition.equipmentSpriteId,81); assert.equal(result.definition.equipmentTrimSpriteId,101);
  assert.deepEqual(result.definition.customField,{keep:true});
  for(const p of PROFILES.shield.parts) {
    const img = await loadImage(result.entries.find(e=>e.filename===p.atlas)!.data);
    assert.equal(img.width,images.get(p.atlas).width);
    assert.equal(Buffer.compare(pixels(extractStrip(img as any,15,p.trim?101:81)),pixels(strips.get(p.key))),0);
    // Every pixel in the old atlas survives appending.
    const before = images.get(p.atlas), preserved = createCanvas(before.width,before.height); preserved.getContext('2d').drawImage(img,0,0);
    const old = createCanvas(before.width,before.height); old.getContext('2d').drawImage(before,0,0);
    assert.equal(Buffer.compare(pixels(preserved),pixels(old)),0);
  }
  for(const e of original.filter(e=>!PROFILES.shield.parts.some(p=>p.atlas===e.filename))) assert.equal(result.entries.find(x=>x.filename===e.filename)!.data,e.data);
  assert.ok(nextSpriteId(entries,images,defs,'shield')>d.equipmentSpriteId!);
});
test('rigid narrow sprites render in every frame and cannot bleed into adjacent frames', () => {
  const img = createCanvas(13,92); img.getContext('2d').fillStyle='#ff0044'; img.getContext('2d').fillRect(0,0,13,92);
  const s = {dataUrl:'',fileName:'spear.png',mode:'single' as const,anchor:{x:6,y:65},poses:generatePoses('weapon',defaultRig())};
  const strip = renderPart(s,img as any,15);
  for(let p=0;p<15;p++) assert.ok(strip.getContext('2d')!.getImageData(p*64,0,64,128).data.some((v,i)=>i%4===3&&v>0),`frame ${p}`);
  s.poses.forEach(p=>p.visible=false); s.poses[0].visible=true; s.poses[0].scaleX=100;
  const clipped = renderPart(s,img as any,15);
  assert.ok(clipped.getContext('2d')!.getImageData(64,0,896,128).data.every(v=>v===0));
});
test('legacy helmet strips require explicit directional selection; source settings survive v3', () => {
  const img = createCanvas(960,128), s = stripSource(img as any,'old helmet');
  assert.throws(()=>renderPart(s,img as any,5),/Choose the five directional/);
  s.legacyFrames=[0,3,6,9,12]; assert.equal(renderPart(s,img as any,5).width,320);
  const legacy = parseProject(JSON.stringify({version:2,item:{id:1000,name:'Helmet',equipmentType:'helmet'},sourceParts:{main:s},autoRig:defaultRig()}));
  assert.equal(legacy.definition._id,1000); assert.deepEqual(legacy.sourceParts.main?.legacyFrames,[0,3,6,9,12]);
  assert.deepEqual(parseProject(JSON.stringify(legacy)),legacy);
  const rigid = parseProject(JSON.stringify({version:2,item:{id:1001,name:'Old rigid helmet',equipmentType:'helmet'},sourceMode:'single',sourceAnchor:{x:4,y:7},poses:generatePoses('helmet',defaultRig())}));
  assert.equal(rigid.sourceParts.main?.requiresDirections,true);
  assert.throws(()=>renderPart(rigid.sourceParts.main!,img as any,5),/five directional frames/);
  const shield = parseProject(JSON.stringify({version:2,item:{id:1002,name:'Old shield',equipmentType:'shield'},sourceMode:'single',sourceAnchor:{x:4,y:7},poses:generatePoses('shield',defaultRig())}));
  assert.equal(shield.sourceParts.front?.anchor.y,7);
});
test('shield automation follows occupied native cells and changes placement with walking', () => {
  const front=images.get('shield_front1.png'), back=images.get('shield_back1.png');
  const f=shieldPoses(front,back,0,defaultRig(),'front'), b=shieldPoses(front,back,0,defaultRig(),'back');
  for (const [poses,img] of [[f,front],[b,back]] as const) {
    const strip=extractStrip(img,15,0);
    for(let i=0;i<15;i++) { const occupied=strip.getContext('2d')!.getImageData(i*64,0,64,128).data.some((v,k)=>k%4===3&&v>0); assert.equal(poses[i].visible,occupied); }
  }
  assert.ok(new Set(f.map(p=>p.x)).size>1);
  assert.ok(f[6].scaleX<f[0].scaleX);
});
test('invalid imports fail; standard project overlays replace appearance and merge definitions', async () => {
  assert.throws(()=>validateAppearance('[{"filename":"a","data":"x"},{"filename":"a","data":"y"}]'),/duplicate/);
  assert.throws(()=>validateDefs('[{"_id":1,"name":"A"},{"_id":1,"name":"B"}]'),/unique/);
  assert.throws(()=>parseProject('{"version":99}'),/version/);
  const file=(path:string,value:any)=>({name:path.split('/').at(-1)!,webkitRelativePath:path,text:async()=>JSON.stringify(value)});
  const result=await readProjectFiles([
    file('repo/apps/shared-assets/base/static/itemdefs.carbon',[{_id:1,name:'A'},{_id:2,name:'B'}]),
    file('repo/apps/shared-assets/custom/static/itemdefs.carbon',[{_id:1,name:'Changed'}]),
    file('repo/apps/shared-assets/base/static/carbon/appearance.carbon',[{filename:'a.png',data:'base'}]),
    file('repo/apps/shared-assets/custom/static/carbon/appearance.carbon',[{filename:'b.png',data:'custom'}]),
  ],{entries:[],defs:[]});
  assert.deepEqual(result.defs,[{_id:1,name:'Changed'},{_id:2,name:'B'}]); assert.equal(result.entries[0].filename,'b.png'); assert.equal(result.entries.length,1);
});
test('project folders connect from any level of the checkout and ignore copies', async () => {
  const file=(path:string,value:any)=>({name:path.split('/').at(-1)!,webkitRelativePath:path,text:async()=>JSON.stringify(value)});
  const layout=(root:string)=>[
    file(`${root}base/static/itemdefs.carbon`,[{_id:1,name:'A'},{_id:2,name:'B'}]),
    file(`${root}custom/static/itemdefs.carbon`,[{_id:1,name:'Changed'},{_id:700,name:'Custom spear'}]),
    file(`${root}base/static/carbon/appearance.carbon`,[{filename:'a.png',data:'base'}]),
  ];
  for (const root of ['openspell/apps/shared-assets/','apps/shared-assets/','shared-assets/','my-assets/']) {
    const {defs,report}=await readProjectFiles(layout(root),{entries:[],defs:[]});
    assert.deepEqual(defs.map(d=>d.name),['Changed','B','Custom spear'],root);
    assert.equal(report.customItems,1,root); assert.equal(report.baseItems,2,root);
    assert.deepEqual(report.used.map(u=>u.layer),['base','base','custom'],root);
  }
  // Dependency and build copies are skipped instead of failing the connection.
  const copies=[...layout('repo/apps/shared-assets/'),...layout('repo/node_modules/openspell/apps/shared-assets/'),...layout('repo/apps/web/build/shared-assets/'),file('repo/.git/x/itemdefs.carbon',[])];
  const {defs,report}=await readProjectFiles(copies,{entries:[],defs:[]});
  assert.equal(defs.length,3); assert.ok(report.used.every(u=>u.path.startsWith('repo/apps/shared-assets/')));
  assert.equal(report.skipped.length,7); assert.ok(report.skipped.some(s=>s.reason.startsWith('inside an ignored')));
  // Only a custom folder: its definitions add to the current library.
  const custom=await readProjectFiles([file('custom/static/itemdefs.carbon',[{_id:900,name:'X'}])],{entries:[],defs:[{_id:1,name:'A'}]});
  assert.deepEqual(custom.defs.map(d=>d._id),[1,900]); assert.equal(custom.report.customItems,1);
  await assert.rejects(readProjectFiles([file('a/itemdefs.carbon',[]),file('b/itemdefs.carbon',[])],{entries:[],defs:[]}),/2 copies of itemdefs.carbon outside the OpenSpell layout/);
  await assert.rejects(readProjectFiles([file('repo/node_modules/itemdefs.carbon',[])],{entries:[],defs:[]}),/outside ignored folders/);
});

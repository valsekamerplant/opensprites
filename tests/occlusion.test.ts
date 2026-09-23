import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createCanvas, loadImage, Image } from '@napi-rs/canvas';
import { buildWeaponCutouts, validateCutoutImage } from '../src/occlusion';
import { canvas, renderPart, extractStrip, generatePoses, stripSource } from '../src/artwork';
import { defaultPose, defaultRig, type SourcePart, type Project } from '../src/model';
import { nativeBundle } from '../src/export';
import { parseProject } from '../src/project';
import { clientLayers, renderClientPose } from '../src/compositor';

(globalThis as any).document = { createElement: () => createCanvas(1,1) };
(globalThis as any).Image = Image;
const entries=JSON.parse(await readFile('public/game/appearance.carbon','utf8'));
const defs=JSON.parse(await readFile('public/game/itemdefs.carbon','utf8'));
const images: Map<string,any> = new Map(await Promise.all(entries.map(async(e:any)=>[e.filename,await loadImage(e.data)])));
const masks=buildWeaponCutouts(images,4);
const pixelData=(c:any)=>c.getContext('2d').getImageData(0,0,c.width,c.height).data;
const alpha=(c:any,x:number,y:number)=>c.getContext('2d').getImageData(x,y,1,1).data[3];
const png=(c:any)=>c.toDataURL('image/png');
const settings={mode:'hands-body' as const,hands:png(masks.hands),rear:png(masks.rear)};

test('cutouts preserve the native longsword and bundled masks match the pinned calibration',async()=>{
  const original=extractStrip(images.get('weapon1.png'),15,4), s=stripSource(original,'longsword'); s.cutout=settings;
  const masked=renderPart(s,original as any,15,masks);
  assert.deepEqual(pixelData(masked),pixelData(original),'native guard, grip gap and pommel must remain intact');
  for(const key of ['hands','rear'] as const){const img=await loadImage(`public/reference/weapon-${key}-mask.png`);const c=createCanvas(960,128);c.getContext('2d').drawImage(img,0,0);assert.deepEqual(pixelData(c),pixelData(masks[key]));}
  assert.throws(()=>validateCutoutImage(createCanvas(64,128) as any),/960/);
});
test('uploaded artwork loses hand pixels in every frame, rear body only on rear views, and restores exactly when disabled',()=>{
  const uploaded=createCanvas(64,128);uploaded.getContext('2d').fillStyle='#f02066';uploaded.getContext('2d').fillRect(0,0,64,128);
  const original=png(uploaded);
  const s:SourcePart={fileName:'my-upload.png',dataUrl:original,mode:'single',anchor:{x:32,y:64},poses:Array.from({length:15},defaultPose),cutout:settings};
  const cut=renderPart(s,uploaded as any,15,masks), hands=renderPart({...s,cutout:{...settings,mode:'hands'}},uploaded as any,15,masks);
  for(let p=0;p<15;p++){
    let removed=0;for(let y=0;y<128;y++)for(let x=0;x<64;x++)if(alpha(masks.hands,p*64+x,y)===255){assert.equal(alpha(cut,p*64+x,y),0);removed++;}
    assert.ok(removed>0,`hand mask in pose ${p}`);
    assert.equal(alpha(hands,p*64+32,50),255,'hand mask must not remove the torso');
    assert.equal(alpha(cut,p*64+32,50),p>=9?0:255,'body must only cover rear-facing weapon frames');
  }
  assert.equal(s.dataUrl,original);assert.equal(png(uploaded),original,'source image is not modified');
  const off=renderPart({...s,cutout:{...settings,mode:'none'}},uploaded as any,15);
  const raw=renderPart({...s,cutout:undefined},uploaded as any,15);
  assert.deepEqual(pixelData(off),pixelData(raw));
  assert.throws(()=>renderPart(s,uploaded as any,15),/missing/);
});
test('cutouts stay fixed on the character after source transforms and survive project/native export',async()=>{
  const uploaded=createCanvas(13,92), c=uploaded.getContext('2d');
  c.fillStyle='#b4d3df';c.fillRect(4,0,5,66);c.fillStyle='#f2b64f';c.fillRect(0,64,13,4);c.fillStyle='#684236';c.fillRect(5,68,3,20);c.fillStyle='#f2b64f';c.fillRect(4,88,5,3);
  const s:SourcePart={fileName:'my-sword.png',dataUrl:png(uploaded),mode:'single',anchor:{x:6,y:66},poses:generatePoses('weapon',defaultRig()),cutout:settings};
  s.poses![1].x+=2;s.poses![2].rotation+=12;
  const decoded = await loadImage(s.dataUrl);
  const raw=renderPart({...s,cutout:undefined},decoded as any,15), masked=renderPart(s,decoded as any,15,masks);
  const before=pixelData(raw),after=pixelData(masked), h=pixelData(masks.hands),r=pixelData(masks.rear);
  let changed=0; for(let i=3;i<after.length;i+=4){ if(h[i]===255||r[i]===255)assert.equal(after[i],0);if(before[i]>after[i])changed++; }
  assert.ok(changed>50,'cuts must affect uploaded art after its transforms');
  const project:Project={version:3,definition:{_id:1000,name:'Uploaded sword',equipmentType:'weapon',equipmentSpriteId:0,equipmentSpriteSheet:'weapon1'},sourceParts:{main:s},replaceExisting:false,autoRig:defaultRig()};
  const restored=parseProject(JSON.stringify(project));assert.deepEqual(restored.sourceParts.main?.cutout,settings);
  const loaded={hands:await loadImage(restored.sourceParts.main!.cutout!.hands),rear:await loadImage(restored.sourceParts.main!.cutout!.rear)};
  assert.equal(Buffer.compare(Buffer.from(pixelData(renderPart(restored.sourceParts.main!,await loadImage(s.dataUrl) as any,15,loaded as any))),Buffer.from(after)),0,'restored masked pixels');
  const exported=await nativeBundle(project,new Map([['main',masked]]),entries,images,defs);
  const atlas=await loadImage(exported.entries.find(e=>e.filename==='weapon1.png')!.data);
  assert.equal(Buffer.compare(Buffer.from(pixelData(extractStrip(atlas as any,15,exported.definition.equipmentSpriteId!))),Buffer.from(after)),0,'exported masked pixels');
  // Inspect the same generated uploaded source before / after in all 15 poses.
  const comparison=createCanvas(960,256), ctx=comparison.getContext('2d'), frame=canvas(64);
  for(let row=0;row<2;row++) for(let p=0;p<15;p++){
    renderClientPose(frame.getContext('2d')!,p,clientLayers({weapon:project.definition}),images,l=>l.slot==='weapon'?(row?masked:raw):undefined);
    ctx.drawImage(frame as any,p*64,row*128);
  }
  const zoom=createCanvas(1920,512);zoom.getContext('2d').fillStyle='#263c30';zoom.getContext('2d').fillRect(0,0,1920,512);zoom.getContext('2d').imageSmoothingEnabled=false;zoom.getContext('2d').drawImage(comparison,0,0,1920,512);
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/uploaded-sword-cutouts.png',zoom.toBuffer('image/png'));
});

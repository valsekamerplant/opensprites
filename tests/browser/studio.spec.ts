import { test, expect } from '@playwright/test';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { readFile, mkdir } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

function unzip(bytes: Buffer) {
  const result = new Map<string,Buffer>(); let p=0;
  while(bytes.readUInt32LE(p)===0x04034b50) { const method=bytes.readUInt16LE(p+8), size=bytes.readUInt32LE(p+18), n=bytes.readUInt16LE(p+26), extra=bytes.readUInt16LE(p+28); const name=bytes.subarray(p+30,p+30+n).toString(); const start=p+30+n+extra; const data=bytes.subarray(start,start+size); result.set(name,method===8?inflateRawSync(data):data); p=start+size; }
  return result;
}
const sprite = createCanvas(13,92); sprite.getContext('2d').fillStyle='#ff0044'; sprite.getContext('2d').fillRect(3,0,7,92);
test('new uploads automatically cut hands and rear body in exported pixels, toggle reversibly, and reopen without game data', async ({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.locator('#status')).toContainText('Ready.');
  const uploaded=createCanvas(13,92);uploaded.getContext('2d').fillStyle='#ddcc88';uploaded.getContext('2d').fillRect(0,0,13,92);
  const original=uploaded.toBuffer('image/png');
  await page.locator('#pngFile').setInputFiles({name:'uploaded-weapon.png',mimeType:'image/png',buffer:original});
  await page.locator('#generate').click();await expect(page.locator('#cutoutMode')).toHaveValue('hands-body');
  const saveLayer=async()=>{const event=page.waitForEvent('download');await page.locator('#layerExport').click();return readFile((await (await event).path())!);};
  const pixels=async(buffer:Buffer)=>{const img=await loadImage(buffer),c=createCanvas(img.width,img.height);c.getContext('2d').drawImage(img,0,0);return c.getContext('2d').getImageData(0,0,c.width,c.height).data;};
  const alpha=(data:Uint8ClampedArray,x:number,y:number)=>data[(y*960+x)*4+3];
  const maskedPNG=await saveLayer(),masked=await pixels(maskedPNG);
  await page.locator('#cutoutMode').selectOption('none');const raw=await pixels(await saveLayer());
  expect(alpha(raw,15,73)).toBe(255);expect(alpha(masked,15,73)).toBe(0);
  expect(alpha(masked,15,40)).toBe(alpha(raw,15,40)); // forearm / blade remains in front
  expect(alpha(raw,12*64+50,40)).toBe(255);expect(alpha(masked,12*64+50,40)).toBe(0);
  await page.locator('#cutoutMode').selectOption('hands');const handsOnly=await pixels(await saveLayer());
  expect(alpha(handsOnly,15,73)).toBe(0);expect(alpha(handsOnly,12*64+50,40)).toBe(255);
  await page.locator('#cutoutMode').selectOption('hands-body');
  const saving=page.waitForEvent('download');await page.locator('#save').click();const draft=await readFile((await (await saving).path())!);
  const saved=JSON.parse(draft.toString());expect(Buffer.from(saved.sourceParts.main.dataUrl.split(',')[1],'base64')).toEqual(original);
  expect(saved.sourceParts.main.cutout.hands).toMatch(/^data:image\/png;base64,/);
  await page.locator('#export').click();const native=page.waitForEvent('download');await page.locator('#native').click();const zip=unzip(await readFile((await (await native).path())!));
  expect(await pixels(zip.get('layers/main.png')!)).toEqual(masked);
  const definition=JSON.parse(zip.get('itemdefs.carbon')!.toString())[0],entries=JSON.parse(zip.get('carbon/appearance.carbon')!.toString());
  const atlas=await loadImage(entries.find((e:any)=>e.filename==='weapon1.png').data),strip=createCanvas(960,128),ctx=strip.getContext('2d');ctx.imageSmoothingEnabled=false;
  for(let p=0;p<15;p++){const cell=definition.equipmentSpriteId*15+p,cols=atlas.width/64;ctx.drawImage(atlas,cell%cols*64,Math.floor(cell/cols)*128,64,128,p*64,0,64,128);}
  expect(ctx.getImageData(0,0,960,128).data).toEqual(masked);
  await page.route('**/game/**',route=>route.abort());await page.route('**/reference/weapon-*-mask.png',route=>route.abort());await page.reload();
  await page.locator('#projectFile').setInputFiles({name:'saved.json',mimeType:'application/json',buffer:draft});await expect(page.locator('#status')).toContainText('Draft loaded');
  expect(await pixels(await saveLayer())).toEqual(masked);expect(errors).toEqual([]);
});
test('standalone rigid sprite renders in all 15 frames, saves, restores, and exports without carbon imports', async ({page}) => {
  const errors: string[]=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.');
  await page.locator('#pngFile').setInputFiles({name:'narrow-spear.png',mimeType:'image/png',buffer:sprite.toBuffer('image/png')});
  await expect(page.locator('#generate')).toBeVisible(); await page.locator('#generate').click();
  await expect(page.locator('#status')).toContainText('Generated 15 poses');
  const visible = await page.evaluate(()=>Array.from({length:15},(_,i)=> { const c=document.getElementById(`frame-${i}`) as HTMLCanvasElement; const p=c.getContext('2d')!.getImageData(0,0,64,128).data; let count=0; for(let k=0;k<p.length;k+=4) if(p[k]>230&&p[k+1]<20&&p[k+2]>45&&p[k+2]<90&&p[k+3]>0) count++; return count; }));
  expect(visible.every(n=>n>20),String(visible)).toBeTruthy();
  const before=await page.locator('#preview').evaluate((c:HTMLCanvasElement)=>c.toDataURL());
  await page.locator('#pose-x').fill('28'); await page.locator('#pose-x').press('Tab');
  expect(await page.locator('#preview').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).not.toBe(before);
  const rotation=Number(await page.locator('#pose-rotation').inputValue()), scaleX=await page.locator('#pose-scaleX').inputValue();
  await page.locator('#preview').dispatchEvent('wheel',{deltaY:-100});
  expect(Number(await page.locator('#pose-rotation').inputValue())).toBe(rotation-5); expect(await page.locator('#pose-scaleX').inputValue()).toBe(scaleX);
  await page.locator('#undo').click(); await expect(page.locator('#status')).toHaveText('Undid edit.');
  await page.locator('#undo').click(); expect(await page.locator('#preview').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(before);
  const draftDownload=page.waitForEvent('download'); await page.locator('#save').click(); const draft=await readFile((await (await draftDownload).path())!);
  const saved=JSON.parse(draft.toString()); expect(saved.sourceParts.main.dataUrl).toMatch(/^data:image/); expect(saved.sourceParts.main.poses).toHaveLength(15);
  await page.locator('#new').click(); await page.locator('#projectFile').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:draft}); await expect(page.locator('#status')).toContainText('Draft loaded');
  expect(await page.locator('#preview').evaluate((c:HTMLCanvasElement)=>c.toDataURL())).toBe(before);
  await page.locator('#export').click(); const packDownload=page.waitForEvent('download'); await page.locator('#pack').click(); const pack=unzip(await readFile((await (await packDownload).path())!));
  expect([...pack.keys()]).toContain('layers/main.png'); expect([...pack.keys()]).not.toContain('carbon/appearance.carbon');
  expect(errors).toEqual([]);
});
test('template shields include paired layers and trims; native export reimports into the library', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.');
  await page.locator('#type').selectOption('shield'); await expect(page.locator('#catalog .item')).toHaveCount(33); await page.locator('#catalog .item').filter({hasText:'coronium shield (gold trim)'}).click();
  await page.locator('#clone').click();
  await expect(page.locator('#status')).toContainText('Copied');
  await expect(page.locator('#layers')).toContainText('● Shield front'); await expect(page.locator('#layers')).toContainText('● Shield rear');
  await expect(page.locator('#layers')).toContainText('● Front trim'); await expect(page.locator('#layers')).toContainText('● Rear trim');
  await page.locator('[data-pose="12"]').click(); await expect(page.locator('#poseLabel')).toContainText('Rear ·');
  await page.locator('#play').click(); await expect(page.locator('#play')).toContainText('Pause'); await page.waitForTimeout(280); await page.locator('#play').click();
  await page.locator('#export').click(); const downloading=page.waitForEvent('download'); await page.locator('#native').click(); const zip=unzip(await readFile((await (await downloading).path())!));
  const definition=JSON.parse(zip.get('itemdefs.carbon')!.toString())[0]; expect(definition.equipmentSpriteSheet).toBe('shield1');
  expect(zip.get('README.txt')!.toString()).toContain('custom/static/itemdefs.carbon');
  await page.locator('#carbonFiles').setInputFiles([{name:'appearance.carbon',mimeType:'application/json',buffer:zip.get('carbon/appearance.carbon')!},{name:'itemdefs.carbon',mimeType:'application/json',buffer:zip.get('itemdefs.carbon')!}]);
  await expect(page.locator('#status')).toContainText('Connected Imported assets');
  // Imported definition resolves to exactly the strips that were exported.
  await page.locator('#search').fill(definition.name);
  await page.locator('#catalog .item').first().click(); await page.locator('#clone').click(); await expect(page.locator('#status')).toContainText('Copied');
  const redownload=page.waitForEvent('download'); await page.locator('#save').click(); const restored=JSON.parse(await readFile((await (await redownload).path())!,'utf8'));
  for(const key of ['front','back','trimFront','trimBack']) expect(Buffer.from(restored.sourceParts[key].dataUrl.split(',')[1],'base64')).toEqual(zip.get(`layers/${key}.png`));
  expect(errors).toEqual([]);
});
test('shield generation creates both faces; special glove replacement retains original source', async ({page})=>{
  await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.');
  await page.locator('#type').selectOption('shield');
  const shield=createCanvas(25,50); shield.getContext('2d').fillStyle='#ee2277'; shield.getContext('2d').fillRect(0,0,25,50);
  await page.locator('#pngFile').setInputFiles({name:'my-shield.png',mimeType:'image/png',buffer:shield.toBuffer('image/png')}); await page.locator('#generate').click();
  await expect(page.locator('#layers')).toContainText('● Shield rear');
  const rear=createCanvas(19,44); rear.getContext('2d').fillStyle='#22aadd'; rear.getContext('2d').fillRect(0,0,19,44);
  await page.locator('#upload-back').click(); await page.locator('#pngFile').setInputFiles({name:'my-shield-rear.png',mimeType:'image/png',buffer:rear.toBuffer('image/png')});
  const download=page.waitForEvent('download'); await page.locator('#save').click(); const draft=JSON.parse(await readFile((await (await download).path())!,'utf8'));
  expect(draft.sourceParts.front.poses.filter((p:any)=>p.visible)).toHaveLength(9); expect(draft.sourceParts.back.poses.filter((p:any)=>p.visible)).toHaveLength(6);
  expect(draft.sourceParts.front.dataUrl).not.toBe(draft.sourceParts.back.dataUrl);
  await page.locator('#type').selectOption('gloves'); await page.locator('#search').fill('611'); await page.locator('#catalog .item').click();
  await page.locator('#editExisting').click(); await expect(page.locator('#operationLabel')).toHaveText('Editing original #611');
  const second=page.waitForEvent('download'); await page.locator('#save').click(); const existing=JSON.parse(await readFile((await (await second).path())!,'utf8'));
  expect(existing.definition._id).toBe(611); expect(existing.sourceParts.main.dataUrl).toBe(existing.sourceParts.main.unbakedDataUrl); expect(existing.replaceExisting).toBe(true);
});
test('templates across all slots, recolour, legacy frame selection, invalid imports, responsive layout', async ({page}) => {
  const errors:string[]=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/'); await expect(page.locator('#status')).toContainText('Ready.');
  for(const type of ['helmet','chest','legs','gloves','boots','back','neck','projectile']) { await page.locator('#type').selectOption(type); await page.locator('#catalog .item').first().click(); await page.locator('#clone').click(); await expect(page.locator('#status')).toContainText('Copied'); }
  await page.locator('#type').selectOption('helmet');
  const strip=createCanvas(960,128); strip.getContext('2d').fillStyle='#0088ff'; strip.getContext('2d').fillRect(26,5,12,20);
  await page.locator('#pngFile').setInputFiles({name:'old-strip.png',mimeType:'image/png',buffer:strip.toBuffer('image/png')});
  await expect(page.locator('#migration')).toBeVisible(); await page.locator('#convert').click(); await expect(page.locator('#migration')).toBeHidden();
  await page.locator('#coloursTab').click();await page.getByText('Tint entire layer',{exact:true}).click(); await page.locator('#tint').fill('#ffee00'); await page.locator('#tint').dispatchEvent('change');
  await page.locator('#projectFile').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":99}')}); await expect(page.locator('#status')).toContainText('Unsupported');
  await page.locator('#type').selectOption('shield'); await page.locator('#catalog .item').nth(12).click(); await page.locator('#clone').click(); await page.locator('[data-pose="6"]').click();
  await mkdir('artifacts',{recursive:true}); await page.screenshot({path:'artifacts/studio-desktop.png',fullPage:true});
  await page.locator('#coloursTab').click();await page.screenshot({path:'artifacts/studio-colours.png',fullPage:true});
  for(const width of [1100,800]) { await page.setViewportSize({width,height:900}); expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy(); }
  expect(errors).toEqual([]);
});

import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { WEAPON_PRESETS } from '../../src/weapon-poses';

const art=createCanvas(16,80); const ctx=art.getContext('2d');ctx.fillStyle='#ff0044';ctx.fillRect(2,0,5,80);ctx.fillStyle='#1166ff';ctx.fillRect(9,0,5,80);
const png=art.toBuffer('image/png');
async function start(page:Page){await page.goto('/');await expect(page.locator('#status')).toContainText('Ready.');}
async function upload(page:Page){await page.locator('#pngFile').setInputFiles({name:'two-colours.png',mimeType:'image/png',buffer:png});await expect(page.locator('#generate')).toBeVisible();}
async function draft(page:Page){const event=page.waitForEvent('download');await page.locator('#save').click();return JSON.parse(await readFile((await (await event).path())!,'utf8'));}
async function layer(page:Page){const event=page.waitForEvent('download');await page.locator('#layerExport').click();const image=await loadImage(await readFile((await (await event).path())!));const c=createCanvas(image.width,image.height);c.getContext('2d').drawImage(image,0,0);return c.getContext('2d').getImageData(0,0,c.width,c.height).data;}
const [gripX,gripY,,,frontWidth]=WEAPON_PRESETS.sword.frames[0];
const count=(data:Uint8ClampedArray,r:number,g:number,b:number)=>{let n=0;for(let i=0;i<data.length;i+=4)if(data[i]===r&&data[i+1]===g&&data[i+2]===b&&data[i+3]===255)n++;return n;};

test('visible pivot, source grip selection, wheel rotation, modifier gestures and draft restore',async({page})=>{
  await start(page);await upload(page);
  await expect(page.locator('#guides')).toBeVisible();await expect(page.locator('#pivotMarker')).toHaveAttribute('transform',`translate(${gripX} ${gripY}) rotate(0)`);
  await page.locator('#preview').hover();await page.mouse.wheel(0,100);await expect(page.locator('#pose-rotation')).toHaveValue('5');await expect(page.locator('#pose-scaleX')).toHaveValue(String(frontWidth));
  await page.keyboard.down('Control');await page.mouse.wheel(0,100);await page.keyboard.up('Control');await expect(page.locator('#pose-scaleX')).toHaveValue(String(Math.round(frontWidth*.95*100)/100));await expect(page.locator('#pose-rotation')).toHaveValue('5');
  const skew=Number(await page.locator('#pose-skewX').inputValue());await page.keyboard.down('Shift');await page.mouse.wheel(0,100);await page.keyboard.up('Shift');await expect(page.locator('#pose-skewX')).toHaveValue(String(skew+1));await expect(page.locator('#pose-rotation')).toHaveValue('5');
  const source=page.locator('#source');const rect=await source.boundingBox();await source.click({position:{x:rect!.width/2,y:rect!.height/2}});await expect(page.locator('#anchorY')).toHaveValue('40');
  await page.locator('#guidesToggle').uncheck();await expect(page.locator('#guides')).toBeHidden();await page.locator('#guidesToggle').check();await expect(page.locator('#guides')).toBeVisible();
  const state=await draft(page);expect(state.sourceParts.main.anchor.y).toBe(40);expect(state.sourceParts.main.poses[0].rotation).toBe(5);
  await page.locator('#new').click();await page.locator('#projectFile').setInputFiles({name:'draft.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(state))});await expect(page.locator('#status')).toContainText('Draft loaded');await expect(page.locator('#guides')).toBeVisible();await expect(page.locator('#pose-rotation')).toHaveValue('5');await expect(page.locator('#anchorY')).toHaveValue('40');
});
test('library previews preserve the draft; clone allocates new identity; edit original preserves identity; new starts blank',async({page})=>{
  await start(page);await upload(page);await page.locator('#name').fill('My new item');await page.locator('#name').press('Tab');const original=await draft(page);
  await page.locator('#search').fill('bronze longsword');await page.locator('#catalog .item').click();await expect(page.locator('#libraryNotice')).toBeVisible();await expect(page.locator('#export')).toBeDisabled();await expect(page.locator('#guides')).toBeHidden();
  await page.locator('#backToDraft').click();expect(await draft(page)).toEqual(original);
  await page.locator('#clone').click();await expect(page.locator('#operationLabel')).toContainText('Clone of #58');const clone=await draft(page);expect(clone.replaceExisting).toBe(false);expect(clone.definition._id).not.toBe(58);expect(clone.templateId).toBe(58);expect(clone.sourceParts.main.mode).toBe('strip');
  // Finished strips now rotate around a visible, editable centre pivot as well.
  await expect(page.locator('#pivotMarker')).toHaveAttribute('transform','translate(32 64) rotate(0)');await page.locator('#preview').hover();await page.mouse.wheel(0,100);await expect(page.locator('#pose-rotation')).toHaveValue('5');
  await page.locator('#editExisting').click();await expect(page.locator('#operationLabel')).toHaveText('Editing original #58');const existing=await draft(page);expect(existing.replaceExisting).toBe(true);expect(existing.definition._id).toBe(58);expect(existing.definition.name).toBe('bronze longsword');
  await page.locator('#new').click();const fresh=await draft(page);expect(fresh.replaceExisting).toBe(false);expect(fresh.sourceParts).toEqual({});expect(fresh.templateId).toBeUndefined();
});
test('colour replacements affect selected colours only, toggle off exactly, and persist with original source',async({page})=>{
  await start(page);await upload(page);const original=await layer(page);
  await page.locator('#coloursTab').click();await page.getByRole('button',{name:'Show colours in #ff0044 group'}).click();await page.getByRole('button',{name:'Select #ff0044',exact:true}).click();await page.locator('#replaceTo').fill('#11ee44');await page.locator('#colourTolerance').focus();await page.locator('#colourTolerance').press('Home');await page.locator('#keepShading').uncheck();await page.locator('#applyColour').click();
  const changed=await layer(page);expect(count(changed,255,0,68)).toBe(0);expect(count(changed,17,238,68)).toBe(count(original,255,0,68));expect(count(changed,17,102,255)).toBe(count(original,17,102,255));
  await page.getByRole('checkbox',{name:'Enable replacement 1'}).uncheck();expect(await layer(page)).toEqual(original);await page.getByRole('checkbox',{name:'Enable replacement 1'}).check();
  const saved=await draft(page);expect(saved.sourceParts.main.replacements).toHaveLength(1);expect(Buffer.from(saved.sourceParts.main.dataUrl.split(',')[1],'base64')).toEqual(png);
  await page.locator('#new').click();await page.locator('#projectFile').setInputFiles({name:'colours.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});await expect(page.locator('#status')).toContainText('Draft loaded');expect(await layer(page)).toEqual(changed);
});

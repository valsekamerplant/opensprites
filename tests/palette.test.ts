import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyColorReplacements, extractPalette, validateColorReplacements, type ColorReplacement, applyTint, groupPalette } from '../src/palette';

test('extracts opaque RGB frequency palette in stable descending order', () => {
  const pixels = new Uint8ClampedArray([255,0,0,255, 0,0,255,128, 255,0,0,64, 0,255,0,0]);
  assert.deepEqual(extractPalette(pixels), [{hex:'#ff0000',count:2},{hex:'#0000ff',count:1}]);
  assert.deepEqual(extractPalette(pixels, 1), [{hex:'#ff0000',count:2}]);
});

test('uses closest eligible original-colour rule, keeps alpha, and does not cascade', () => {
  const pixels = new Uint8ClampedArray([100,100,100,255, 102,100,100,73, 0,0,0,0]);
  const rules: ColorReplacement[] = [
    {from:'#646464',to:'#ff0000',tolerance:5,preserveShading:false},
    {from:'#656464',to:'#00ff00',tolerance:5,preserveShading:false},
    {from:'#ff0000',to:'#0000ff',tolerance:100,preserveShading:false},
  ];
  applyColorReplacements(pixels, rules);
  assert.deepEqual([...pixels], [255,0,0,255, 0,255,0,73, 0,0,0,0]);
});

test('tolerance is normalized RGB distance and shading scales target by source lightness', () => {
  const pixels = new Uint8ClampedArray([55,55,55,200, 110,110,110,100]);
  applyColorReplacements(pixels, [{from:'#6e6e6e',to:'#8080ff',tolerance:100,preserveShading:true}]);
  assert.deepEqual([...pixels], [64,64,128,200, 128,128,255,100]);
  const outside = new Uint8ClampedArray([255,0,0,255]);
  applyColorReplacements(outside, [{from:'#000000',to:'#ffffff',tolerance:50,preserveShading:false}]);
  assert.deepEqual([...outside], [255,0,0,255]);
});

test('validates bounded replacement rules and palette parameters', () => {
  assert.throws(() => validateColorReplacements([{from:'red',to:'#000000',tolerance:0,preserveShading:false}]), /source colour/);
  assert.throws(() => validateColorReplacements([{from:'#000000',to:'#ffffff',tolerance:101,preserveShading:false}]), /tolerance/);
  assert.throws(() => validateColorReplacements([{from:'#000000',to:'#ffffff',tolerance:1,preserveShading:1}]), /preserveShading/);
  assert.throws(() => validateColorReplacements(Array.from({length:33}, () => ({from:'#000000',to:'#ffffff',tolerance:0,preserveShading:false}))), /at most 32/);
  assert.throws(() => extractPalette(new Uint8ClampedArray(), 257), /limit/);
});

test('tint reshades: average becomes the tint, outline and highlight survive, shades stay in the tint family', () => {
  // black outline, three shades of grey metal, white highlight, one transparent pixel
  const data = new Uint8ClampedArray([0,0,0,255, 80,80,80,255, 120,120,120,255, 160,160,160,255, 255,255,255,255, 90,10,10,0]);
  const before = data.slice();
  applyTint(data, '#3070c0');
  const lumAt = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  assert.ok(lumAt(0) < 25 && data[3] === 255, 'the outline stays near black');
  assert.ok(lumAt(16) > 235, 'the highlight stays near white');
  assert.deepEqual([...data.slice(20)], [...before.slice(20)], 'transparent pixels untouched');
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  assert.ok(lum(4) < lum(8) && lum(8) < lum(12), 'shading order is kept');
  for (const i of [4, 8, 12]) assert.ok(data[i + 2] > data[i + 1] && data[i + 1] > data[i], 'every shade is blue-dominant like the tint');
  const flat = new Uint8ClampedArray([100,100,100,255, 100,100,100,255]);
  applyTint(flat, '#3070c0');
  assert.deepEqual([...flat.slice(0, 3)], [0x30, 0x70, 0xc0], 'the average shade becomes the tint exactly');
  assert.throws(() => applyTint(flat, 'blue'), /Invalid colour/);
});

test('palettes group into shades of the same material', () => {
  const pal = (hexes: string[]) => hexes.map((hex, i) => ({ hex, count: 10 + i }));
  // wood ramp, grey line ramp, red bobber: the great rod's three materials
  const groups = groupPalette(pal(['#3f1900', '#7f3300', '#a1381e', '#c1723e', '#e0ab5d', '#969696', '#aaaaaa', '#bbbbbb', '#e0e0e0', '#ffffff', '#dd0000', '#ff0000', '#ff1919']));
  assert.equal(groups.length, 3);
  const find = (hex: string) => groups.find(g => g.colours.some(c => c.hex === hex))!;
  assert.equal(find('#3f1900'), find('#e0ab5d'), 'dark and light wood are one group');
  assert.notEqual(find('#dd0000'), find('#a1381e'), 'the red bobber is not the reddish wood');
  assert.equal(find('#969696'), find('#ffffff'));
  for (const g of groups) for (let i = 1; i < g.colours.length; i++) {
    const l = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5), 16);
    assert.ok(l(g.colours[i].hex) >= l(g.colours[i - 1].hex), 'each group runs dark to light');
  }
  assert.ok(groupPalette(pal(['#3f1900', '#e0ab5d', '#dd0000']), 0).length === 3, 'zero strength keeps every colour apart');
});

test('a group rule recolours every shade as a ramp and reaches near colours in other art', () => {
  const data = new Uint8ClampedArray([40,40,40,255, 100,100,100,255, 160,160,160,255, 200,40,40,255, 102,100,100,255]);
  applyColorReplacements(data, [{ from: '#646464', to: '#2060e0', tolerance: 2, preserveShading: true, colours: ['#282828', '#646464', '#a0a0a0'] }]);
  assert.deepEqual([...data.slice(12, 16)], [200, 40, 40, 255], 'other groups are untouched');
  for (const i of [0, 4, 8, 16]) assert.ok(data[i + 2] > data[i + 1] && data[i + 2] > data[i], 'every matched shade stays blue (hue-shifted shadows and highlights included)');
  const lum = (i: number) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  assert.ok(lum(0) < lum(4) && lum(4) < lum(8), 'shading order is kept');
  assert.throws(() => validateColorReplacements([{ from: '#000000', to: '#ffffff', tolerance: 0, preserveShading: true, colours: [] }]), /colour group/);
  assert.throws(() => validateColorReplacements([{ from: '#000000', to: '#ffffff', tolerance: 0, preserveShading: true, colours: ['#000000'], reshade: 101 }]), /reshade/);
});

test('reshading shifts hue like hand shading and stretches flat groups; strength 0 keeps one hue', () => {
  const greys = ['#707070', '#787878', '#808080', '#888888', '#909090'];
  const run = (reshade: number) => {
    const data = new Uint8ClampedArray(greys.flatMap(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5), 16), 255]));
    applyColorReplacements(data, [{ from: '#808080', to: '#c03030', tolerance: 0, preserveShading: true, colours: greys, reshade }]);
    return [0, 4, 8, 12, 16].map(i => [...data.slice(i, i + 3)]);
  };
  const shaded = run(50), plain = run(0);
  assert.deepEqual(shaded[2], [0xc0, 0x30, 0x30], 'the average shade is the chosen colour exactly');
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(shaded[4]) - lum(shaded[0]) > lum(plain[4]) - lum(plain[0]), 'a low-contrast group gains visible shading');
  assert.ok(shaded[0][2] > shaded[0][1], 'the shadow leans toward purple');
  assert.ok(shaded[4][1] > shaded[4][2], 'the highlight leans toward orange/yellow');
  const ratio = (c: number[]) => c[1] / Math.max(1, c[0]);
  assert.ok(Math.abs(ratio(plain[0]) - ratio(plain[4])) < Math.abs(ratio(shaded[0]) - ratio(shaded[4])), 'strength 0 does not shift hue');
});

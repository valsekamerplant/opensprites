import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyColorReplacements, extractPalette, validateColorReplacements, type ColorReplacement } from '../src/palette';

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

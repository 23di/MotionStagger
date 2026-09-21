import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(path) {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { samplePreviewTrack: sample } = await load('src/shared/preview-motion.ts');
const track = { field: 'OPACITY', baseValue: 1, keyframes: [
  { time: .5, value: 0, easing: 'LINEAR' },
  { time: 1, value: 1, easing: 'EASE_IN' },
  { time: 2, value: 0, easing: 'HOLD' },
] };
assert.equal(sample(track, 0, 1), 0, 'A delayed entrance holds its first value before the start');
assert.equal(sample(track, .75, 1), .25, 'Easing belongs to the arriving key');
assert.equal(sample(track, 1.999, 1), 1, 'HOLD retains the preceding value');
assert.equal(sample(track, 2, 1), 0, 'HOLD reaches the next value exactly at its key');
const { previewBackground } = await load('src/plugin/preview-background.ts');
const paints = [
  { type: 'GRADIENT_LINEAR', gradientTransform: [[0,1,0],[-1,0,1]], gradientStops: [
    { position: 0, color: {r:.7,g:.9,b:1,a:1} }, { position: 1, color: {r:.85,g:.96,b:1,a:1} },
  ] },
  { type: 'SOLID', color: {r:1,g:1,b:1} },
  { type: 'SOLID', visible: false, color: {r:1,g:0,b:0} },
];
const before = JSON.stringify(paints);
const svg = previewBackground(paints);
assert.match(svg, /gradientTransform="matrix\(0 1 -1 0 1 0\)"/, 'Figma gradient coordinates are mapped back to frame coordinates');
assert.ok(svg.indexOf('rgb(255,255,255)') < svg.indexOf('<linearGradient'), 'Paint order is retained');
assert.ok(!svg.includes('rgb(255,0,0)'));
assert.equal(JSON.stringify(paints), before, 'Preview must not mutate the frame paints');
assert.equal(previewBackground([]), undefined);
console.log('Preview easing, delayed entrances and frame background checks passed.');

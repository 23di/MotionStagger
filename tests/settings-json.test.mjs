import assert from 'node:assert/strict';
import { build } from 'esbuild';

const result = await build({ entryPoints: ['src/shared/settings-json.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { parseStaggerSettingsJson, stringifyStaggerSettings } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
const settings = {
  operation: 'stagger', staggerBy: 'tracks', groupLevel: 'immediate', order: 'align-end',
  distribution: 'custom', distributionBezier: [.25, .1, .25, 1], spanMs: -1250,
  startOffsetMs: 300, anchor: 'playhead', alignment: 'preserve', trackScope: 'transform',
  keyframeEasing: 'CUSTOM_CUBIC_BEZIER', customBezier: [.42, 0, .58, 1], randomSeed: 17,
};
assert.deepEqual(parseStaggerSettingsJson(stringifyStaggerSettings(settings)), settings);
assert.equal(parseStaggerSettingsJson(JSON.stringify({ ...settings, staggerBy: 'layers' })).order, 'right-left');
for (const invalid of [
  '{', '[]', '{}', JSON.stringify({ ...settings, spanMs: '100' }),
  JSON.stringify({ ...settings, distributionBezier: [-1, 0, 1, 1] }),
  JSON.stringify({ ...settings, customBezier: null }),
  JSON.stringify({ ...settings, operation: 'easing' }),
  JSON.stringify({ ...settings, alignment: 'start' }),
  JSON.stringify({ ...settings, surprise: 'ignored?' }),
]) assert.throws(() => parseStaggerSettingsJson(invalid));
console.log('Stagger settings JSON round-trip and rejection checks passed.');

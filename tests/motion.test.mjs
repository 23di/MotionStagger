import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const mutationLog = [];
function forbiddenPresetWrite() {
  mutationLog.push("preset-write");
  throw new Error("Preset writes are forbidden");
}

function keyframe(id, timelinePosition) {
  return {
    id,
    timelinePosition,
    easing: { type: "LINEAR" },
    value: { type: "FLOAT", value: timelinePosition },
  };
}

function binding(id) {
  return {
    id,
    baseValue: { type: "FLOAT", value: 0 },
    keyframes: [keyframe(`${id}-a`, 0), keyframe(`${id}-b`, 1)],
  };
}

function createNode(id = "1:2", x = 0, y = 0) {
  return {
    id,
    name: "Animated layer",
    type: "RECTANGLE",
    removed: false,
    absoluteBoundingBox: { x, y, width: 100, height: 100 },
    manualKeyframeTracks: {
      TRANSLATION_X: binding("translation"),
      OPACITY: binding("opacity"),
    },
    animations: {},
    animationStyles: [],
    timelines: [{ id: `timeline:${id}`, duration: 1 }],
    applyManualKeyframeTrack(field, track) {
      mutationLog.push(`manual:${this.id}`);
      const fieldLabel = field.type === "PROPERTY" ? field.name : `${field.collection}-${field.index}`;
      const nextTrack = {
        id: track.id ?? `${fieldLabel}-track`,
        baseValue: track.baseValue ?? { type: "FLOAT", value: 0 },
        keyframes: track.keyframes.map((frame, index) => ({
          ...frame,
          id: frame.id ?? `${fieldLabel}-${index}`,
          easing: frame.easing ?? { type: "LINEAR" },
        })),
      };
      if (field.type === "PROPERTY") {
        this.manualKeyframeTracks[field.name] = nextTrack;
        return;
      }
      this.manualKeyframeTracks[field.collection] ??= {};
      if (field.propertyId) {
        this.manualKeyframeTracks[field.collection][field.index] ??= { properties: {} };
        this.manualKeyframeTracks[field.collection][field.index].properties ??= {};
        this.manualKeyframeTracks[field.collection][field.index].properties[field.propertyId] = nextTrack;
      } else if (field.field) {
        this.manualKeyframeTracks[field.collection][field.index] ??= {};
        this.manualKeyframeTracks[field.collection][field.index][field.field] = nextTrack;
      } else {
        this.manualKeyframeTracks[field.collection][field.index] = nextTrack;
      }
    },
    removeManualKeyframeTrack(field) {
      mutationLog.push(`remove-manual:${this.id}`);
      if (field.type === "PROPERTY") {
        delete this.manualKeyframeTracks[field.name];
        return;
      }
      const collection = this.manualKeyframeTracks[field.collection];
      const item = collection?.[field.index];
      if (!item) return;
      if (field.propertyId) {
        delete item.properties?.[field.propertyId];
      } else if (field.field) {
        delete item[field.field];
      } else {
        delete collection[field.index];
      }
    },
    applyAnimationStyle: forbiddenPresetWrite,
    removeAnimationStyle: forbiddenPresetWrite,
    setTimelineDuration(id, duration) { mutationLog.push(`timeline:${this.id}`); this.timelines = [{ id, duration }]; },
  };
}

function createContainer(id, children) {
  const node = createNode(id);
  node.type = "FRAME";
  node.name = "Motion container";
  node.manualKeyframeTracks = {};
  node.children = children;
  for (const child of children) child.parent = node;
  return node;
}

function settings(overrides = {}) {
  return {
    staggerBy: "tracks",
    groupLevel: "immediate",
    order: "top-bottom",
    distribution: "linear",
    spanMs: 1000,
    startOffsetMs: 0,
    anchor: "relative",
    alignment: "preserve",
    trackScope: "all",
    keyframeEasing: "preserve",
    randomSeed: 17,
    ...overrides,
  };
}

const node = createNode();
const previewSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>';
node.exportAsync = async (settings) => settings.format === "SVG_STRING" ? previewSvg : Uint8Array.of(1, 2, 3);
const events = {};
const messages = [];
const figma = {
  skipInvisibleInstanceChildren: false,
  currentPage: { selection: [node], children: [] },
  createFrame: forbiddenPresetWrite,
  createRectangle: forbiddenPresetWrite,
  createLine: forbiddenPresetWrite,
  motion: { playheadPosition: 0, figmaAnimationStyles: () => [] },
  base64Encode: () => "AQID",
  ui: { onmessage: null, postMessage: (message) => messages.push(message), resize() {} },
  showUI() {},
  notify() {},
  on(name, handler) { events[name] = handler; },
};

const context = { figma, __html__: "", console, JSON, Math, Map, Set, Object, Array, Number, Error, encodeURIComponent };
vm.runInNewContext(readFileSync(process.env.CASCADE_TEST_CODE ?? new URL("../dist/code.js", import.meta.url), "utf8"), context);

const writesBeforePreviewRead = mutationLog.length;
await figma.ui.onmessage({ type: "scan-selection" });
const previewSummary = messages.findLast(message => message.type === "selection-summary").payload;
assert.equal(mutationLog.length, writesBeforePreviewRead);
assert.equal(previewSummary.motionPreview.length, 0);
assert.deepEqual(Array.from(previewSummary.timingPreview.tracks.find(track => track.id === node.id).times), [0, 1]);
assert.equal(previewSummary.timingPreview.truncated, false);

await Promise.resolve();
assert.equal(messages.some(message => message.type === "preview-images"), false);

const beforePlan = JSON.stringify(node.manualKeyframeTracks);
const mutationsBeforePlan = mutationLog.length;
await figma.ui.onmessage({ type: "plan-stagger", settings: settings() });
assert.equal(mutationLog.length, mutationsBeforePlan);
assert.equal(JSON.stringify(node.manualKeyframeTracks), beforePlan);
const planned = messages.findLast(message => message.type === "preview-plan").nodes[0];
const timingPlan = messages.findLast(message => message.type === "preview-plan").timingPreview;
assert.deepEqual(Array.from(timingPlan.tracks[0].times), [0, 2]);
assert.equal(timingPlan.duration, 1, "Preview scale uses the frame timeline, not planned key extent");
assert.equal(timingPlan.tracks[0].originalStart, 0);
assert.equal(timingPlan.tracks[0].originalEnd, 1);

assert.deepEqual(Array.from(planned.tracks.find(track => track.field === "OPACITY").keyframes, frame => frame.time), [1, 2]);

const serviceLayers = Array.from({ length: 18 }, (_, index) => {
  const layer = createNode(`service-${index}`);
  layer.name = `Frame ${index} · Orbit Depth (service)`;
  return layer;
});
figma.currentPage.selection = [...serviceLayers, node];
await figma.ui.onmessage({ type: "scan-selection" });
assert.deepEqual(Array.from(messages.findLast(message => message.type === "selection-summary").payload.nodes, item => item.id), [...serviceLayers.map(layer => layer.id), node.id]);
const previewFrame = createContainer('preview-frame', [node]);
previewFrame.absoluteBoundingBox = { x: 20, y: 30, width: 960, height: 560 };
previewFrame.getTopLevelFrame = () => previewFrame;
figma.currentPage.selection = [previewFrame];
await figma.ui.onmessage({ type: "scan-selection" });
assert.equal(messages.findLast(message => message.type === "selection-summary").payload.motionPreviewFrame, undefined);
node.parent = undefined;
figma.currentPage.selection = [node];
await figma.ui.onmessage({ type: "scan-selection" });

const nestedLeaf = createNode('nested-preview-leaf');
const animatedParent = createContainer('animated-preview-parent', [nestedLeaf]);
animatedParent.manualKeyframeTracks = { OPACITY: binding('parent-opacity') };
const nestedFrame = createContainer('nested-preview-frame', [animatedParent]);
figma.currentPage.selection = [nestedFrame];
await figma.ui.onmessage({ type: "scan-selection" });
const nestedSummary = messages.findLast(message => message.type === 'selection-summary').payload;
assert.deepEqual(Array.from(nestedSummary.nodes, item => item.id), [animatedParent.id, nestedLeaf.id]);
assert.deepEqual(Array.from(nestedSummary.motionPreview, item => item.id), [], 'Selection scans omit preview artwork');
figma.currentPage.selection = [node];
await figma.ui.onmessage({ type: "scan-selection" });

await figma.ui.onmessage({ type: "preview-stagger", settings: settings() });
assert.deepEqual(node.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(node.manualKeyframeTracks.OPACITY.keyframes.map((frame) => frame.timelinePosition), [1, 2]);
const liveTiming = messages.findLast(message => message.type === "selection-summary").payload.timingPreview;
const opacityTiming = liveTiming.tracks.find(track => track.id === node.id);
assert.deepEqual(Array.from(opacityTiming.times), [0, 2]);
assert.equal(liveTiming.tracks.length, 1, "All parameters of one layer share one preview row");
assert.equal(opacityTiming.originalStart, 0);
assert.equal(opacityTiming.originalEnd, 1);


await figma.ui.onmessage({ type: "reset-stagger" });
assert.deepEqual(node.manualKeyframeTracks.OPACITY.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(Array.from(messages.findLast(message => message.type === "selection-summary").payload.timingPreview.tracks.find(track => track.id === node.id).times), [0, 1]);


await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ trackScope: "position" }),
});
assert.deepEqual(node.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "keyframes", trackScope: "position" }),
});
assert.deepEqual(node.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 2]);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", spanMs: 0, startOffsetMs: 500 }),
});
assert.deepEqual(node.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);

await figma.ui.onmessage({
  type: "apply-stagger",
  settings: settings({ staggerBy: "layers", spanMs: 0, startOffsetMs: 500 }),
});
await figma.ui.onmessage({ type: "reset-stagger" });
assert.deepEqual(node.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);

const top = createNode("top", 100, 0);
const middle = createNode("middle", 100, 100);
const bottom = createNode("bottom", 100, 200);
figma.currentPage.selection = [bottom, top, middle];
events.selectionchange();

await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position" }),
});
assert.deepEqual(top.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(middle.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
assert.deepEqual(bottom.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", order: "bottom-top" }),
});
assert.deepEqual(bottom.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(middle.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
assert.deepEqual(top.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);

await figma.ui.onmessage({ type: "reset-stagger" });
top.absoluteBoundingBox = { x: 0, y: 100, width: 100, height: 100 };
middle.absoluteBoundingBox = { x: 150, y: 100, width: 100, height: 100 };
bottom.absoluteBoundingBox = { x: 300, y: 100, width: 100, height: 100 };
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", order: "left-right" }),
});
assert.deepEqual(top.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(middle.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
assert.deepEqual(bottom.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", order: "right-left" }),
});
assert.deepEqual(top.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);
assert.deepEqual(middle.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
assert.deepEqual(bottom.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", order: "center-out" }),
});
assert.deepEqual(middle.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(top.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);
assert.deepEqual(bottom.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", order: "edges-in" }),
});
assert.deepEqual(top.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(bottom.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(middle.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);

// Match the supplied Figma file: one selected frame owns three animated children.
// The children share the same Y coordinate, so timeline/layer-tree order is the
// deterministic fallback for Top -> Bottom and must reverse for Bottom -> Up.
await figma.ui.onmessage({ type: "reset-stagger" });
const firstChild = createNode("4946:24062", 0, 0);
const secondChild = createNode("4946:24063", 200, 0);
const thirdChild = createNode("4946:24064", 400, 0);
const selectedFrame = createContainer("4946:24061", [firstChild, secondChild, thirdChild]);
figma.currentPage.selection = [selectedFrame];
events.selectionchange();

await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", order: "top-bottom" }),
});
assert.deepEqual(firstChild.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(secondChild.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
assert.deepEqual(thirdChild.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", order: "bottom-top" }),
});
assert.deepEqual(firstChild.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);
assert.deepEqual(secondChild.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
assert.deepEqual(thirdChild.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);

await figma.ui.onmessage({ type: "reset-stagger" });
const groupAFirst = createNode("group-a-1", 0, 0);
const groupASecond = createNode("group-a-2", 20, 20);
const groupBFirst = createNode("group-b-1", 0, 200);
const groupBSecond = createNode("group-b-2", 20, 220);
const groupA = createContainer("group-a", [groupAFirst, groupASecond]);
const groupB = createContainer("group-b", [groupBFirst, groupBSecond]);
const groupedFrame = createContainer("grouped-frame", [groupA, groupB]);
figma.currentPage.selection = [groupedFrame];
events.selectionchange();

await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "groups", groupLevel: "immediate", trackScope: "position" }),
});
assert.deepEqual(groupAFirst.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(groupASecond.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(groupBFirst.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);
assert.deepEqual(groupBSecond.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);

await figma.ui.onmessage({ type: "reset-stagger" });
const grid = Array.from({ length: 9 }, (_, index) => createNode(
  `grid-${index}`,
  (index % 3) * 120,
  Math.floor(index / 3) * 120,
));
const gridFrame = createContainer("grid-frame", [grid[8], grid[3], grid[1], grid[6], grid[0], grid[5], grid[2], grid[7], grid[4]]);
figma.currentPage.selection = [gridFrame];
events.selectionchange();
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", order: "top-bottom", trackScope: "position", spanMs: 800 }),
});
assert.deepEqual(
  grid.map((item) => item.manualKeyframeTracks.TRANSLATION_X.keyframes[0].timelinePosition),
  [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", order: "bottom-top", trackScope: "position", spanMs: 800 }),
});
assert.deepEqual(
  grid.map((item) => item.manualKeyframeTracks.TRANSLATION_X.keyframes[0].timelinePosition),
  [0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0],
);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", order: "left-right", trackScope: "position", spanMs: 800 }),
});
assert.deepEqual(
  grid.map((item) => item.manualKeyframeTracks.TRANSLATION_X.keyframes[0].timelinePosition),
  [0, 0.3, 0.6, 0.1, 0.4, 0.7, 0.2, 0.5, 0.8],
);

await figma.ui.onmessage({ type: "reset-stagger" });
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", order: "right-left", trackScope: "position", spanMs: 800 }),
});
assert.deepEqual(
  grid.map((item) => item.manualKeyframeTracks.TRANSLATION_X.keyframes[0].timelinePosition),
  [0.8, 0.5, 0.2, 0.7, 0.4, 0.1, 0.6, 0.3, 0],
);

await figma.ui.onmessage({ type: "reset-stagger" });
// One selected track must never be stretched by the horizontal timing controls.
const singleTrack = createNode("single-track", 0, 0);
delete singleTrack.manualKeyframeTracks.OPACITY;
figma.currentPage.selection = [singleTrack];
events.selectionchange();
await figma.ui.onmessage({ type: "preview-stagger", settings: settings({ order: "left-right" }) });
assert.deepEqual(singleTrack.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
await figma.ui.onmessage({ type: "preview-stagger", settings: settings({ order: "right-left" }) });
assert.deepEqual(singleTrack.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
await figma.ui.onmessage({ type: "reset-stagger" });

// Scope, anchor, and easing only touch the intended track data.
const scoped = createNode("scoped", 0, 0);
figma.currentPage.selection = [scoped];
events.selectionchange();
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ trackScope: "appearance", spanMs: 0, startOffsetMs: 500, keyframeEasing: "EASE_OUT" }),
});
assert.deepEqual(scoped.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(scoped.manualKeyframeTracks.OPACITY.keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
assert.ok(scoped.manualKeyframeTracks.OPACITY.keyframes.every((frame) => frame.easing.type === "EASE_OUT"));
await figma.ui.onmessage({ type: "reset-stagger" });
figma.motion.playheadPosition = 2;
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "position", spanMs: 0, anchor: "playhead" }),
});
assert.deepEqual(scoped.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [2, 3]);
await figma.ui.onmessage({ type: "reset-stagger" });
figma.motion.playheadPosition = 0;

// Full mode/order smoke matrix: no negative/NaN timing and Reset is lossless.
const modes = ["tracks", "keyframes", "layers", "groups"];
const orders = ["selection", "top-bottom", "bottom-top", "left-right", "right-left", "center-out", "edges-in", "random"];
for (const mode of modes) {
  for (const order of orders) {
    const matrixNodes = [
      createNode(`matrix-${mode}-${order}-0`, 0, 0),
      createNode(`matrix-${mode}-${order}-1`, 120, 0),
      createNode(`matrix-${mode}-${order}-2`, 0, 120),
      createNode(`matrix-${mode}-${order}-3`, 120, 120),
    ];
    const matrixFrame = createContainer(`matrix-${mode}-${order}`, matrixNodes);
    figma.currentPage.selection = [matrixFrame];
    events.selectionchange();
    const messageStart = messages.length;
    await figma.ui.onmessage({
      type: "preview-stagger",
      settings: settings({ staggerBy: mode, order, spanMs: 750, distribution: "ease-in-out" }),
    });
    assert.ok(messages.slice(messageStart).some((message) => message.type === "preview-applied"), `${mode}/${order} should preview`);
    assert.ok(!messages.slice(messageStart).some((message) => message.type === "plugin-error"), `${mode}/${order} should not error`);
    for (const item of matrixNodes) {
      for (const track of Object.values(item.manualKeyframeTracks)) {
        assert.ok(track.keyframes.every((frame) => Number.isFinite(frame.timelinePosition) && frame.timelinePosition >= 0));
      }
    }
    await figma.ui.onmessage({ type: "reset-stagger" });
    for (const item of matrixNodes) {
      assert.deepEqual(item.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
      assert.deepEqual(item.manualKeyframeTracks.OPACITY.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
    }
  }
}

// Large keyframe selections exercise the optimized center/edge path used by
// live preview; output must remain valid and chronologically ordered.
const denseKeyframeNode = createNode("dense-keyframes", 0, 0);
delete denseKeyframeNode.manualKeyframeTracks.OPACITY;
denseKeyframeNode.manualKeyframeTracks.TRANSLATION_X.keyframes = Array.from(
  { length: 2001 },
  (_, index) => keyframe(`dense-${index}`, index / 1000),
);
figma.currentPage.selection = [denseKeyframeNode];
events.selectionchange();
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "keyframes", order: "center-out", trackScope: "position" }),
});
const densePositions = denseKeyframeNode.manualKeyframeTracks.TRANSLATION_X.keyframes.map(
  (frame) => frame.timelinePosition,
);
assert.equal(densePositions.length, 2001);
assert.ok(densePositions.every(Number.isFinite));
assert.ok(densePositions.every((position, index) => index === 0 || densePositions[index - 1] <= position));
await figma.ui.onmessage({ type: "reset-stagger" });

// Distribution curves produce the expected middle delay.
for (const [distribution, middleDelay] of [["linear", 0.5], ["ease-in", 0.25], ["ease-out", 0.75], ["ease-in-out", 0.5]]) {
  const curveNodes = [createNode(`curve-${distribution}-0`, 0, 0), createNode(`curve-${distribution}-1`, 0, 100), createNode(`curve-${distribution}-2`, 0, 200)];
  figma.currentPage.selection = curveNodes;
  events.selectionchange();
  await figma.ui.onmessage({
    type: "preview-stagger",
    settings: settings({ staggerBy: "layers", trackScope: "position", distribution }),
  });
  assert.equal(curveNodes[1].manualKeyframeTracks.TRANSLATION_X.keyframes[0].timelinePosition, middleDelay);
  await figma.ui.onmessage({ type: "reset-stagger" });
}

// Every exposed easing value is passed through without changing values or IDs.
const easingValues = ["preserve", "LINEAR", "EASE_IN", "EASE_OUT", "EASE_IN_AND_OUT", "EASE_IN_BACK", "EASE_OUT_BACK", "EASE_IN_AND_OUT_BACK", "GENTLE", "QUICK", "BOUNCY", "SLOW", "HOLD"];
for (const easing of easingValues) {
  const easingNode = createNode(`easing-${easing}`, 0, 0);
  delete easingNode.manualKeyframeTracks.OPACITY;
  const originalIds = easingNode.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.id);
  figma.currentPage.selection = [easingNode];
  events.selectionchange();
  await figma.ui.onmessage({ type: "preview-stagger", settings: settings({ keyframeEasing: easing }) });
  assert.deepEqual(easingNode.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.id), originalIds);
  const expectedEasing = easing === "preserve" ? "LINEAR" : easing;
  assert.ok(easingNode.manualKeyframeTracks.TRANSLATION_X.keyframes.every((frame) => frame.easing.type === expectedEasing));
  await figma.ui.onmessage({ type: "reset-stagger" });
}

// Custom curves retain all four coordinates (including overshoot) across
// preview/apply, leave other scopes intact, and restore the original on Reset.
const bezierNode = createNode("custom-bezier");
const bezierOriginal = structuredClone(bezierNode.manualKeyframeTracks);
figma.currentPage.selection = [bezierNode];
events.selectionchange();
const bezierSettings = settings({ trackScope: "appearance", spanMs: 0,
  keyframeEasing: "CUSTOM_CUBIC_BEZIER", customBezier: [0.2, -0.4, 0.8, 1.3] });
for (const type of ["preview-stagger", "preview-stagger", "apply-stagger"]) {
  await figma.ui.onmessage({ type, settings: bezierSettings });
  assert.deepEqual(bezierNode.manualKeyframeTracks.TRANSLATION_X, bezierOriginal.TRANSLATION_X);
  assert.equal(JSON.stringify(bezierNode.manualKeyframeTracks.OPACITY.keyframes), JSON.stringify(
    bezierOriginal.OPACITY.keyframes.map(frame => ({ ...frame,
      easing: { type: "CUSTOM_CUBIC_BEZIER", easingFunctionCubicBezier: { x1: 0.2, y1: -0.4, x2: 0.8, y2: 1.3 } },
    }))));
}
// Invalid input must not write or roll back the preceding valid preview.
await figma.ui.onmessage({ type: "preview-stagger", settings: bezierSettings });
const beforeInvalid = JSON.stringify(bezierNode.manualKeyframeTracks);
for (const customBezier of [undefined, [0, 1, 2], [NaN, 0, 1, 1], [0, Infinity, 1, 1], [-0.1, 0, 1, 1], [0, 0, 1.1, 1], ["0", 0, 1, 1]]) {
  for (const type of ["preview-stagger", "apply-stagger"]) {
    const writes = mutationLog.length;
    await figma.ui.onmessage({ type, settings: { ...bezierSettings, customBezier } });
    assert.equal(messages.at(-1).type, "plugin-error");
    assert.equal(mutationLog.length, writes);
    assert.equal(JSON.stringify(bezierNode.manualKeyframeTracks), beforeInvalid);
  }
}
await figma.ui.onmessage({ type: "reset-stagger" });
assert.equal(JSON.stringify(bezierNode.manualKeyframeTracks), JSON.stringify(bezierOriginal));
// Alignment ignores hidden easing settings, even an incomplete saved curve.
await figma.ui.onmessage({ type: "preview-stagger", settings: { ...bezierSettings, order: "align-start", customBezier: undefined, distribution: "custom", distributionBezier: undefined } });
assert.ok(bezierNode.manualKeyframeTracks.OPACITY.keyframes.every(frame => frame.easing.type === "LINEAR"));
await figma.ui.onmessage({ type: "reset-stagger" });

// Custom distribution evaluates Y at the requested X, including signed spans.
for (const spanMs of [1000, -1000]) {
  const layers = [0, 1, 2].map(i => createNode(`custom-distribution-${spanMs}-${i}`, 0, i * 100));
  figma.currentPage.selection = layers;
  events.selectionchange();
  const config = settings({ staggerBy: "layers", trackScope: "position", distribution: "custom",
    distributionBezier: [1 / 3, 0, 2 / 3, 0], spanMs });
  await figma.ui.onmessage({ type: "preview-stagger", settings: config });
  const times = layers.map(n => n.manualKeyframeTracks.TRANSLATION_X.keyframes[0].timelinePosition);
  const expected = spanMs > 0 ? [0, 0.125, 1] : [1, 0.875, 0];
  times.forEach((time, i) => assert.ok(Math.abs(time - expected[i]) < 1e-8));
  const writes = mutationLog.length;
  await figma.ui.onmessage({ type: "preview-stagger", settings: { ...config, distributionBezier: [2, 0, 1, 1] } });
  assert.equal(messages.at(-1).type, "plugin-error");
  assert.equal(mutationLog.length, writes);
  await figma.ui.onmessage({ type: "preview-stagger", settings: { ...config, spanMs: 1000, distributionBezier: [0, 0, 0, 1] } });
  const t = Math.cbrt(0.5);
  assert.ok(Math.abs(layers[1].manualKeyframeTracks.TRANSLATION_X.keyframes[0].timelinePosition - (3*t*t - 2*t*t*t)) < 1e-8);
  await figma.ui.onmessage({ type: "reset-stagger" });
}

// Standalone easing uses committed timing, ignores hidden cascade/scope/alignment
// settings, and changes every selected track without touching timeline duration.
const massNodes = [createNode("mass-a"), createNode("mass-b", 0, 100)];
const massOriginal = JSON.stringify(massNodes.map(n => n.manualKeyframeTracks));
figma.currentPage.selection = [createContainer("mass-frame", massNodes)];
events.selectionchange();
await figma.ui.onmessage({ type: "apply-stagger", settings: settings({ spanMs: 900 }) });
const timingOnly = () => JSON.stringify(massNodes.map(n => Object.values(n.manualKeyframeTracks).map(b => ({...b, keyframes: b.keyframes.map(({ easing, ...frame }) => frame)}))));
const committedTiming = timingOnly();
const timelines = JSON.stringify(massNodes.map(n => n.timelines));
const massSettings = settings({ operation: "easing", trackScope: "position", order: "align-end",
  spanMs: -3000, startOffsetMs: 3000, distribution: "custom", distributionBezier: undefined,
  keyframeEasing: "CUSTOM_CUBIC_BEZIER", customBezier: [0.2, -0.3, 0.9, 1.2] });
for (const type of ["preview-stagger", "preview-stagger", "apply-stagger"]) {
  const writes = mutationLog.length;
  await figma.ui.onmessage({ type, settings: massSettings });
  assert.equal(timingOnly(), committedTiming);
  assert.equal(JSON.stringify(massNodes.map(n => n.timelines)), timelines);
  assert.ok(mutationLog.slice(writes).every(write => write.startsWith("manual:")));
  for (const n of massNodes) for (const b of Object.values(n.manualKeyframeTracks)) {
    assert.ok(b.keyframes.every(frame => frame.easing.type === "CUSTOM_CUBIC_BEZIER"));
  }
}
await figma.ui.onmessage({ type: "preview-stagger", settings: { ...massSettings, keyframeEasing: "HOLD" } });
await figma.ui.onmessage({ type: "cancel-preview" });
assert.equal(timingOnly(), committedTiming);
assert.ok(massNodes.every(n => n.manualKeyframeTracks.OPACITY.keyframes.every(f => f.easing.type === "CUSTOM_CUBIC_BEZIER")));
await figma.ui.onmessage({ type: "reset-stagger" });
assert.equal(JSON.stringify(massNodes.map(n => n.manualKeyframeTracks)), massOriginal);
console.log("Custom distribution and standalone mass easing checks passed.");

// Start anchoring, layout scope, and indexed paint tracks are handled independently.
const layoutNode = createNode("layout-scope", 0, 0);
layoutNode.manualKeyframeTracks.WIDTH = binding("width");
figma.currentPage.selection = [layoutNode];
events.selectionchange();
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "layout", spanMs: 0, startOffsetMs: 250, anchor: "start" }),
});
assert.deepEqual(layoutNode.manualKeyframeTracks.WIDTH.keyframes.map((frame) => frame.timelinePosition), [0.25, 1.25]);
assert.deepEqual(layoutNode.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
await figma.ui.onmessage({ type: "reset-stagger" });

const paintNode = createNode("paint-track", 0, 0);
paintNode.manualKeyframeTracks = { fills: { 0: binding("fill-color") } };
figma.currentPage.selection = [paintNode];
events.selectionchange();
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "layers", trackScope: "appearance", spanMs: 0, startOffsetMs: 500 }),
});
assert.deepEqual(paintNode.manualKeyframeTracks.fills[0].keyframes.map((frame) => frame.timelinePosition), [0.5, 1.5]);
await figma.ui.onmessage({ type: "reset-stagger" });

// Top-level grouping keeps nested children in the same stagger cohort.
const nestedA1 = createNode("nested-a-1", 0, 0);
const nestedA2 = createNode("nested-a-2", 0, 50);
const nestedB1 = createNode("nested-b-1", 0, 200);
const nestedB2 = createNode("nested-b-2", 0, 250);
const outerA = createContainer("outer-a", [createContainer("inner-a-1", [nestedA1]), createContainer("inner-a-2", [nestedA2])]);
const outerB = createContainer("outer-b", [createContainer("inner-b-1", [nestedB1]), createContainer("inner-b-2", [nestedB2])]);
const nestedRoot = createContainer("nested-root", [outerA, outerB]);
figma.currentPage.selection = [nestedRoot];
events.selectionchange();
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "groups", groupLevel: "top-level", trackScope: "position" }),
});
assert.deepEqual(nestedA1.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(nestedA2.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [0, 1]);
assert.deepEqual(nestedB1.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);
assert.deepEqual(nestedB2.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition), [1, 2]);
await figma.ui.onmessage({ type: "reset-stagger" });

// Individually staggered keyframes are submitted in chronological order even
// when a reverse order makes their original positions cross.
const crossingKeyframes = createNode("crossing-keyframes", 0, 0);
delete crossingKeyframes.manualKeyframeTracks.OPACITY;
crossingKeyframes.manualKeyframeTracks.TRANSLATION_X.keyframes[1].timelinePosition = 0.1;
figma.currentPage.selection = [crossingKeyframes];
events.selectionchange();
await figma.ui.onmessage({
  type: "preview-stagger",
  settings: settings({ staggerBy: "keyframes", order: "right-left", trackScope: "position" }),
});
assert.deepEqual(
  crossingKeyframes.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.timelinePosition),
  [0.1, 1],
);
assert.deepEqual(
  crossingKeyframes.manualKeyframeTracks.TRANSLATION_X.keyframes.map((frame) => frame.id),
  ["translation-b", "translation-a"],
);
await figma.ui.onmessage({ type: "reset-stagger" });

// Reject preset and mixed selections before any write, regardless of definition
// metadata, scope, direction, repeated messages, or the old conversion route.
const preset = (id, styleId = 'CodeComponentId:4959:12', props = {}) => ({
  id, type: 'FIGMA', styleId, name: 'motion.preset_name.opacity',
  duration: 0.5, timelineOffset: 0, props: { type: 'fadeIn', delay: 0, ...props },
});
const freeze = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const styled = (id, entries, mixed = false) => {
  const n = createNode(id);
  if (!mixed) n.manualKeyframeTracks = {};
  Object.defineProperty(n, 'animationStyles', { value: freeze(entries), writable: false });
  Object.defineProperty(n, 'animations', { get() { throw Error('Must not resolve preset tracks'); } });
  return n;
};
figma.motion.figmaAnimationStyles = () => { mutationLog.push('catalog-probe'); throw Error('No style discovery needed'); };
const allNodes = roots => [...new Set(roots.flatMap(n => [n, ...allNodes(n.children ?? [])]))];
const motionState = roots => JSON.stringify(allNodes(roots).map(n => ({
  id: n.id, styles: n.animationStyles, manual: n.manualKeyframeTracks, timelines: n.timelines,
})));
const presetSelections = [
  [styled('known', [preset('known-instance', 'Opacity')])],
  [styled('opaque', [{ id: 'opaque-instance', styleId: 'CodeComponentId:88:22', name: 'Unknown' }])],
  [styled('multiple', [preset('one'), preset('two', 'Opacity', { type: 'fadeOut' })])],
  [styled('mixed-node', [preset('mixed-instance')], true)],
  [createNode('manual-before-preset'), styled('preset-after-manual', [preset('later-instance')])],
  [createContainer('selected-frame', [createNode('manual-descendant'), createContainer('nested-frame', [
    styled('nested-preset', [preset('nested-instance')]),
  ])])],
];
const pageFrameWithPreset = createContainer('page-frame-with-preset', [createNode('manual-child')]);
pageFrameWithPreset.parent = { id: 'page', type: 'PAGE' };
pageFrameWithPreset.animationStyles = freeze([preset('frame-preset')]);
presetSelections.push([pageFrameWithPreset]);
for (const selection of presetSelections) {
  const before = motionState(selection);
  const mutationsBefore = mutationLog.length;
  figma.currentPage.selection = selection;
  events.selectionchange();
  const summary = messages.at(-1).payload;
  assert.ok(summary.styleCount > 0);
  assert.equal(summary.canReset, false);
  for (const staggerBy of ['tracks', 'layers', 'groups', 'keyframes', 'align']) {
    for (const order of ['top-bottom', 'align-start', 'align-end']) {
      for (const type of ['plan-stagger', 'preview-stagger', 'apply-stagger']) {
        for (const trackScope of ['all', 'position']) {
          await figma.ui.onmessage({ type, settings: settings({ staggerBy, order, trackScope, spanMs: -600 }) });
          assert.equal(messages.at(-1).type, 'plugin-error');
          assert.match(messages.at(-1).message, /cannot be edited without recreating presets/);
        }
      }
    }
  }
  await figma.ui.onmessage({ type: 'convert-styles' });
  assert.equal(messages.at(-1).type, 'plugin-error');
  await figma.ui.onmessage({ type: 'reset-stagger' });
  events.close();
  figma.currentPage.selection = [];
  events.selectionchange();
  assert.equal(mutationLog.length, mutationsBefore, 'Blocked selection must perform zero writes or probes');
  assert.equal(motionState(selection), before);
}

// Manual tracks retain signed cascade, edge alignment, IDs, duration and easing.
const alignA = createNode('align-manual-a');
const alignB = createNode('align-manual-b');
for (const n of [alignA, alignB]) delete n.manualKeyframeTracks.OPACITY;
alignA.manualKeyframeTracks.TRANSLATION_X.keyframes.forEach(k => k.timelinePosition += 1);
alignB.manualKeyframeTracks.TRANSLATION_X.keyframes[1].timelinePosition = 3;
figma.currentPage.selection = [alignA, alignB];
events.selectionchange();
const originalAlignment = motionState([alignA, alignB]);
const times = () => [alignA, alignB].map(n => n.manualKeyframeTracks.TRANSLATION_X.keyframes.map(k => k.timelinePosition));
await figma.ui.onmessage({ type: 'preview-stagger', settings: settings({ order: 'align-start', spanMs: -2500, keyframeEasing: 'EASE_OUT' }) });
assert.deepEqual(times(), [[0, 1], [0, 3]]);
await figma.ui.onmessage({ type: 'preview-stagger', settings: settings({ order: 'align-end', spanMs: -2500 }) });
assert.deepEqual(times(), [[2, 3], [0, 3]]);
assert.ok(alignA.manualKeyframeTracks.TRANSLATION_X.keyframes.every(k => k.easing.type === 'LINEAR'));
for (let repeat = 0; repeat < 3; repeat++) {
  await figma.ui.onmessage({ type: 'preview-stagger', settings: settings({ spanMs: -1500 }) });
  assert.deepEqual(times(), [[2.5, 3.5], [0, 3]]);
}
await figma.ui.onmessage({ type: 'reset-stagger' });
assert.equal(motionState([alignA, alignB]), originalAlignment);

// Apply/cancel/Reset semantics remain intact for supported manual-only edits.
for (const cancel of [() => events.close(), () => { figma.currentPage.selection = []; events.selectionchange(); }]) {
  const n = createNode('committed-manual');
  figma.currentPage.selection = [n];
  events.selectionchange();
  const original = motionState([n]);
  const opts = settings({ spanMs: 0, startOffsetMs: 500 });
  await figma.ui.onmessage({ type: 'preview-stagger', settings: opts });
  const mutationsBefore = mutationLog.length;
  await figma.ui.onmessage({ type: 'apply-stagger', settings: opts });
  assert.equal(mutationLog.length, mutationsBefore, 'Apply must reuse the preview');
  const committed = motionState([n]);
  await figma.ui.onmessage({ type: 'preview-stagger', settings: { ...opts, startOffsetMs: 1000 } });
  cancel();
  assert.equal(motionState([n]), committed);
  await figma.ui.onmessage({ type: 'reset-stagger' });
  assert.equal(motionState([n]), original);
}

// Fail closed even when presets appear after the original selection scan.
const staleTarget = createNode('stale-apply-target');
figma.currentPage.selection = [createNode('previous-apply-selection')];
events.selectionchange();
const previousSelectionKey = messages.at(-1).payload.conversionSelectionKey;
figma.currentPage.selection = [staleTarget];
const staleTargetBefore = motionState([staleTarget]);
const staleWritesBefore = mutationLog.length;
await figma.ui.onmessage({ type: 'apply-stagger', settings: settings(), selectionKey: previousSelectionKey });
assert.equal(messages.at(-1).type, 'plugin-error');
assert.equal(mutationLog.length, staleWritesBefore, 'Stale Apply must not mutate a newly selected layer');
assert.equal(motionState([staleTarget]), staleTargetBefore);

const changed = createNode('selection-now-has-preset');
figma.currentPage.selection = [changed];
events.selectionchange();
changed.animationStyles = [preset('externally-added')];
const beforeChange = motionState([changed]);
const beforeWrites = mutationLog.length;
await figma.ui.onmessage({ type: 'preview-stagger', settings: settings() });
assert.equal(messages.at(-1).type, 'plugin-error');
assert.equal(mutationLog.length, beforeWrites);
assert.equal(motionState([changed]), beforeChange);

// Guard the shipped bundle as well as runtime behavior: no dormant creation,
// removal, conversion probes, or catalog discovery may be shipped again.
const bundled = readFileSync(new URL('../dist/code.js', import.meta.url), 'utf8');
for (const api of ['applyAnimationStyle', 'figmaAnimationStyles', 'createFrame', 'createRectangle', 'createLine']) {
  assert.ok(!bundled.includes(api), `Unexpected preset mutation/probe API in bundle: ${api}`);
}
console.log('Motion Stagger manual timing and preset no-write tests passed.');

// Explicit conversion is the only route allowed to remove existing presets.
let undoSnapshot;
let undoCalls = 0;
let commitCalls = 0;
figma.commitUndo = () => {
  commitCalls++;
  undoSnapshot = allNodes(figma.currentPage.selection).map(n => ({ node: n, data: JSON.parse(motionState([n]))[0] }));
};
figma.triggerUndo = () => {
  undoCalls++;
  for (const { node, data } of undoSnapshot) {
    node.animationStyles = structuredClone(data.styles);
    node.manualKeyframeTracks = structuredClone(data.manual);
    node.timelines = structuredClone(data.timelines);
  }
};
const presetTrack = (id, operation, times, values) => ({ id, keyframeOperation: operation,
  keyframes: times.map((t, i) => ({...keyframe(`${id}:${i}`, t), easing: {type: 'EASE_OUT'}, value:{type:'FLOAT',value:values[i]}})),
});
const convertible = (id, tracks, styleCount = tracks.length, baseValue = 1) => {
  const n = createNode(id);
  n.manualKeyframeTracks = {};
  n.animationStyles = Array.from({length:styleCount}, (_,i)=>{
    const times=tracks[i]?.keyframes.map(frame=>frame.timelinePosition) ?? [0,.5];
    const start=Math.min(...times),end=Math.max(...times);
    return {...preset(`${id}:preset:${i}`),duration:end-start,timelineOffset:start};
  });
  n.animations = {OPACITY:{baseValue:{type:'FLOAT',value:baseValue},timelineDuration:3,tracks}};
  n.removeAnimationStyle = function(id) { mutationLog.push('explicit-preset-removal');this.animationStyles=this.animationStyles.filter(s=>s.id!==id); };
  return n;
};
const selectForConversion = nodes => { figma.currentPage.selection=nodes;events.selectionchange();return messages.at(-1).payload.conversionSelectionKey; };
const convert = async nodes => { const selectionKey=selectForConversion(nodes);await figma.ui.onmessage({type:'convert-styles',selectionKey}); };
const opacityTimes = n => Array.from(n.manualKeyframeTracks.OPACITY.keyframes,k=>k.timelinePosition);
const opacityValues = n => Array.from(n.manualKeyframeTracks.OPACITY.keyframes,k=>k.value.value);

// Parent selection and direct child selection must resolve the same preset-only fields.
for (const direct of [false, true]) {
  const children = Array.from({length: 4}, (_, index) => {
    const n = convertible(`selection-route-${direct}-${index}`, [presetTrack('move', 'OFFSET', [0, .5], [-200, 0])], 1);
    n.animations = {
      TRANSLATION_X: {...n.animations.OPACITY, baseValue: {type:'FLOAT',value:383}},
      TRANSLATION_Y: {...n.animations.OPACITY, tracks:[presetTrack('y','OFFSET',[0,.5],[0,0])],baseValue:{type:'FLOAT',value:378}},
    };
    return n;
  });
  const root = createContainer(`selection-route-parent-${direct}`, children);
  const writes = mutationLog.length;
  const key = selectForConversion(direct ? children : [root]);
  assert.equal(mutationLog.length, writes, 'Selection must remain read-only');
  assert.equal(messages.at(-1).payload.nodes.length, 4);
  await figma.ui.onmessage({type:'convert-styles',selectionKey:key});
  assert.notEqual(messages.at(-1).type,'plugin-error');
  for (const n of children) {
    assert.equal(n.animationStyles.length, 0);
    assert.deepEqual(Array.from(n.manualKeyframeTracks.TRANSLATION_X.keyframes,k=>k.value.value),[-200,0]);
  }
}


for (const [id,tracks,count,expectedTimes,expectedValues,base] of [
  ['single-set',[presetTrack('single','SET',[0,.4],[0,1])],1,[0,.4],[0,1],1],
  ['two-set',[presetTrack('in','SET',[0,.4],[0,1]),presetTrack('out','SET',[1,1.5],[1,0])],2,[0,.4,1,1.5],[0,1,1,0],1],
  ['touching',[presetTrack('in','SET',[0,.4],[0,1]),presetTrack('out','SET',[.4,1],[1,0])],2,[0,.4,1],[0,1,0],1],
  ['single-offset',[presetTrack('move','OFFSET',[.1,.5],[0,5])],1,[.1,.5],[10,15],10],
  ['two-scale',[presetTrack('in','SCALE',[0,.4],[0,1]),presetTrack('out','SCALE',[1,1.5],[1,0])],2,[0,.4,1,1.5],[0,1,1,0],1],
]) {
  const n=convertible(id,tracks,count,base);
  const timelines=structuredClone(n.timelines);
  await convert([n]);
  assert.ok(messages.some(m=>m.type==='styles-converted' && m.nodeIds.includes(id)));
  assert.equal(n.animationStyles.length,0);
  assert.deepEqual(opacityTimes(n),expectedTimes);
  assert.deepEqual(opacityValues(n),expectedValues);
  assert.ok(n.manualKeyframeTracks.OPACITY.keyframes.every(k=>['EASE_OUT','HOLD'].includes(k.easing.type)));
  if(id==='two-set'||id==='two-scale') assert.equal(n.manualKeyframeTracks.OPACITY.keyframes[2].easing.type,'HOLD','Gap between presets must hold');
  assert.deepEqual(n.timelines,timelines);
  const baked=motionState([n]);
  await figma.ui.onmessage({type:'preview-stagger',settings:settings({startOffsetMs:250})});
  await figma.ui.onmessage({type:'apply-stagger',settings:settings({startOffsetMs:250})});
  await figma.ui.onmessage({type:'reset-stagger'});
  assert.equal(motionState([n]),baked,'Reset must restore baked tracks, not presets');
}
// Conversion followed by local planning has no Apply snapshot, but Reset must
// acknowledge completion and leave the baked keyframes and presets untouched.
await figma.ui.onmessage({type:'reset-stagger'});
const resetAfterConversion=convertible('reset-after-conversion',[presetTrack('reset-source','SET',[0,.5],[0,1])]);
await convert([resetAfterConversion]);
const bakedResetState=motionState([resetAfterConversion]);
const resetWrites=mutationLog.length;
await figma.ui.onmessage({type:'plan-stagger',settings:settings({startOffsetMs:500}),requestId:42});
assert.equal(messages.at(-1).type,'preview-plan');
const beforeResetMessages=messages.length;
await figma.ui.onmessage({type:'reset-stagger'});
assert.ok(messages.slice(beforeResetMessages).some(message=>message.type==='reset-complete'));
assert.equal(mutationLog.length,resetWrites,'Reset before Apply must not write baked tracks');
assert.equal(motionState([resetAfterConversion]),bakedResetState);
assert.equal(messages.at(-1).payload.canReset,false);

const delayedPreset=convertible('delayed-preset',[presetTrack('delayed','SET',[0,.5],[0,1])]);
delayedPreset.animationStyles[0].timelineOffset=.829;
delayedPreset.animationStyles[0].duration=.5;
await convert([delayedPreset]);
assert.deepEqual(opacityTimes(delayedPreset),[.829,1.329],'Relative preset keyframes must keep the offset without a flashing base-value lead-in');
assert.deepEqual(opacityValues(delayedPreset),[0,1]);

const absolutePreset=convertible('absolute-preset',[presetTrack('absolute','SET',[1.25,1.65],[0,1])]);
absolutePreset.animationStyles[0].timelineOffset=1.25;
absolutePreset.animationStyles[0].duration=.4;
await convert([absolutePreset]);
assert.deepEqual(opacityTimes(absolutePreset),[1.25,1.65],'Already absolute keyframes must not be shifted twice');

const delayedPair=convertible('delayed-pair',[
  presetTrack('delayed-pair:preset:0','SET',[0,.4],[0,1]),
  presetTrack('delayed-pair:preset:1','SET',[0,.5],[1,0]),
]);
delayedPair.animationStyles[0].timelineOffset=.75;
delayedPair.animationStyles[0].duration=.4;
delayedPair.animationStyles[1].timelineOffset=1.75;
delayedPair.animationStyles[1].duration=.5;
await convert([delayedPair]);
assert.deepEqual(opacityTimes(delayedPair),[.75,1.15,1.75,2.25]);
assert.equal(delayedPair.manualKeyframeTracks.OPACITY.keyframes[2].easing.type,'HOLD');

const touchingEasing=convertible('touching-easing',[
  presetTrack('touching-easing:preset:0','SET',[0,.4],[0,1]),
  presetTrack('touching-easing:preset:1','SET',[.4,.8],[1,0]),
]);
touchingEasing.animations.OPACITY.tracks[1].keyframes.forEach(frame=>{frame.easing={type:'EASE_IN'};});
await convert([touchingEasing]);
assert.deepEqual(opacityTimes(touchingEasing),[0,.4,.8]);
assert.equal(touchingEasing.manualKeyframeTracks.OPACITY.keyframes[1].easing.type,'EASE_OUT','The preceding segment owns incoming easing at a shared boundary');

const ambiguousPair=convertible('ambiguous-pair',[
  presetTrack('unmatched-one','SET',[0,.4],[0,1]),
  presetTrack('unmatched-two','SET',[0,.4],[1,0]),
]);
ambiguousPair.animationStyles[0].timelineOffset=.75;
ambiguousPair.animationStyles[0].duration=.4;
ambiguousPair.animationStyles[1].timelineOffset=1.75;
ambiguousPair.animationStyles[1].duration=.4;
const ambiguousBefore=motionState([ambiguousPair]);
const ambiguousWrites=mutationLog.length;
await convert([ambiguousPair]);
assert.equal(messages.at(-1).type,'plugin-error');
assert.equal(motionState([ambiguousPair]),ambiguousBefore);
assert.equal(mutationLog.length,ambiguousWrites,'Ambiguous offsets must fail before writes');
// Current Figma supplies an explicit source preset even when durations match.
const linkedPair=convertible('linked-pair',[
  presetTrack('track-in','SET',[0,.4],[0,1]),presetTrack('track-out','SET',[0,.4],[1,0]),
]);
linkedPair.animationStyles[0].timelineOffset=.75;
linkedPair.animationStyles[1].timelineOffset=1.75;
linkedPair.animations.OPACITY.tracks.forEach((track,i)=>{track.animationPreset={id:linkedPair.animationStyles[i].id};});
await convert([linkedPair]);
assert.equal(linkedPair.animationStyles.length,0);
assert.deepEqual(opacityTimes(linkedPair),[.75,1.15,1.75,2.15]);
assert.deepEqual(opacityValues(linkedPair),[0,1,1,0]);
// Reduced from frame 5447:99313: short fades coexist with longer slide/scale
// presets. Resolved keyframes use preset-local positions and IDs do not match
// applied style IDs; duration disambiguates the different timeline offsets.
const layeredPresets=convertible('layered-presets',[
  presetTrack('KeyframeTrackId:5447:99414','SCALE',[0,.15],[0,1]),
  presetTrack('KeyframeTrackId:5447:99425','SCALE',[0,.2],[1,0]),
],5);
layeredPresets.animationStyles=[
  { ...preset('AnimationPresetId:5447:99406'),duration:1.2,timelineOffset:0 },
  { ...preset('AnimationPresetId:5447:99413'),duration:.15,timelineOffset:0 },
  { ...preset('AnimationPresetId:5447:99417'),duration:.6,timelineOffset:3.4 },
  { ...preset('AnimationPresetId:5447:99424'),duration:.2,timelineOffset:3.4 },
  { ...preset('AnimationPresetId:5447:99428'),duration:3,timelineOffset:0 },
];
layeredPresets.animations.TRANSLATION_Y={baseValue:{type:'FLOAT',value:91},timelineDuration:4,tracks:[
  presetTrack('KeyframeTrackId:5447:99410','OFFSET',[0,1.2],[440,0]),
  presetTrack('KeyframeTrackId:5447:99421','OFFSET',[0,.6],[0,-880]),
]};
layeredPresets.animations.SCALE_X={baseValue:{type:'FLOAT',value:1},timelineDuration:4,tracks:[
  presetTrack('KeyframeTrackId:5447:99429','SCALE',[0,3],[1.4,1]),
]};
await convert([layeredPresets]);
assert.equal(layeredPresets.animationStyles.length,0);
assert.deepEqual(opacityTimes(layeredPresets),[0,.15,3.4,3.6]);
assert.deepEqual(Array.from(layeredPresets.manualKeyframeTracks.TRANSLATION_Y.keyframes,k=>k.timelinePosition),[0,1.2,3.4,4]);
assert.deepEqual(Array.from(layeredPresets.manualKeyframeTracks.TRANSLATION_Y.keyframes,k=>k.value.value),[440,0,0,-880], 'Motion translation must not add the layout Y twice');
assert.deepEqual(Array.from(layeredPresets.manualKeyframeTracks.SCALE_X.keyframes,k=>k.timelinePosition),[0,3]);
const roundedReadback=convertible('rounded-readback',[presetTrack('rounded','SCALE',[0,.2175],[0,1])]);
roundedReadback.animationStyles[0].timelineOffset=.3815;
const writeRounded=roundedReadback.applyManualKeyframeTrack;
roundedReadback.applyManualKeyframeTrack=function(field,input){
  writeRounded.call(this,field,input);
  for(const frame of this.manualKeyframeTracks[field.name].keyframes){
    frame.timelinePosition=Math.fround(frame.timelinePosition);
    frame.value.value=Math.fround(frame.value.value);
  }
};
await convert([roundedReadback]);
assert.equal(roundedReadback.animationStyles.length,0,'Figma float32 readback should still verify and convert');
assert.equal(roundedReadback.manualKeyframeTracks.OPACITY.keyframes[0].easing.type,'EASE_OUT');
const multipleFields=convertible('multiple-fields',[presetTrack('fade','SET',[0,1],[0,1])],1);
multipleFields.animations.TRANSLATION_X={baseValue:{type:'FLOAT',value:0},timelineDuration:3,tracks:[presetTrack('move','OFFSET',[0,1],[-20,0])]};
await convert([multipleFields]);
assert.equal(Object.keys(multipleFields.manualKeyframeTracks).length,2);
assert.deepEqual(Array.from(multipleFields.manualKeyframeTracks.TRANSLATION_X.keyframes,k=>k.value.value),[-20,0]);

const overlap=convertible('overlap',[presetTrack('a','SET',[0,1],[0,1]),presetTrack('b','SET',[.5,1.5],[1,0])]);
const discontinuity=convertible('jump',[presetTrack('a','SET',[0,.5],[0,1]),presetTrack('b','SET',[1,1.5],[0,1])]);
const mixedOperations=convertible('mixed-operations',[presetTrack('a','OFFSET',[0,.5],[0,1]),presetTrack('b','SCALE',[1,1.5],[1,0])]);
const noResolved=convertible('no-resolved',[],1);
const manualConflict=convertible('manual-conflict',[presetTrack('a','SET',[0,1],[0,1])]);
manualConflict.manualKeyframeTracks.OPACITY=binding('existing-manual');
const malformed=convertible('malformed',[presetTrack('a','SET',[0,NaN],[0,1])]);
for (const invalid of [overlap,discontinuity,mixedOperations,noResolved,manualConflict,malformed]) {
  const valid=convertible(`before-${invalid.id}`,[presetTrack('valid','SET',[0,1],[0,1])]);
  const before=motionState([valid,invalid]);
  const writes=mutationLog.length, commits=commitCalls;
  await convert([valid,invalid]);
  assert.equal(messages.at(-1).type,'plugin-error');
  assert.equal(mutationLog.length,writes);
  assert.equal(commitCalls,commits,'Preflight must not even create undo boundaries');
  assert.equal(motionState([valid,invalid]),before);
}
// Native Undo is used for a partial write/removal failure, never preset creation.
for (const failure of ['manual-throw','silent-write','remove-second','silent-removal']) {
  const n=convertible(failure,[presetTrack(`${failure}:preset:0`,'SET',[0,.5],[0,1]),presetTrack(`${failure}:preset:1`,'SET',[1,1.5],[1,0])]);
  const apply=n.applyManualKeyframeTrack;
  if(failure==='manual-throw') n.applyManualKeyframeTrack=function(field,input){apply.call(this,field,input);throw Error('write failed');};
  if(failure==='silent-write') n.applyManualKeyframeTrack=function(field,input){apply.call(this,field,{...input,keyframes:input.keyframes.slice(0,1)});};
  const remove=n.removeAnimationStyle;
  if(failure==='remove-second') n.removeAnimationStyle=function(id){if(this.animationStyles.length===1)throw Error('remove failed');remove.call(this,id);};
  if(failure==='silent-removal') n.removeAnimationStyle=function(){};
  const before=motionState([n]);const undos=undoCalls;
  await convert([n]);
  assert.equal(messages.at(-1).type,'plugin-error');
  assert.equal(undoCalls,undos+1);
  assert.equal(motionState([n]),before,'Undo must preserve original preset IDs and all manual data');
}
// Reordering the same targets/presets is not a selection change.
const orderedA=convertible('order-a',[presetTrack('order-a:preset:0','SET',[0,.5],[0,1]),presetTrack('order-a:preset:1','SET',[1,1.5],[1,0])]);
const orderedB=convertible('order-b',[presetTrack('order-b:preset:0','SET',[0,.5],[0,1])]);
const orderedKey=selectForConversion([orderedA,orderedB]);
orderedA.animationStyles.reverse();
assert.equal(selectForConversion([orderedB,orderedA]),orderedKey);
await figma.ui.onmessage({type:'convert-styles',selectionKey:orderedKey});
assert.equal(orderedA.animationStyles.length+orderedB.animationStyles.length,0);
assert.ok(messages.some(message=>message.type==='styles-converted' && message.nodeIds.includes('order-a')));

// A genuinely different selection must fail without any writes.
const targetA=convertible('target-a',[presetTrack('target-a:preset:0','SET',[0,.5],[0,1])]);
const targetB=convertible('target-b',[presetTrack('target-b:preset:0','SET',[0,.5],[0,1])]);
const targetKey=selectForConversion([targetA]);
selectForConversion([targetB]);
const targetWrites=mutationLog.length;
await figma.ui.onmessage({type:'convert-styles',selectionKey:targetKey});
assert.equal(messages.at(-1).type,'plugin-error');
assert.equal(mutationLog.length,targetWrites);
await figma.ui.onmessage({type:'convert-styles'});
assert.equal(messages.at(-1).type,'plugin-error');
assert.match(messages.at(-1).message,/selected layers or presets changed/);
assert.equal(mutationLog.length,targetWrites);

const staleConversion=convertible('stale-conversion',[presetTrack('a','SET',[0,1],[0,1])]);
const oldSelectionKey=selectForConversion([staleConversion]);
staleConversion.animationStyles=[preset('replaced-in-figma')];
const staleBefore=motionState([staleConversion]);const staleWrites=mutationLog.length;
const messagesBeforeStale=messages.length;
await figma.ui.onmessage({type:'convert-styles',selectionKey:oldSelectionKey});
assert.equal(messages.at(-1).type,'plugin-error');
assert.ok(messages.slice(messagesBeforeStale).some(message=>message.type==='selection-summary' && message.payload.conversionSelectionKey.includes('replaced-in-figma')));
assert.equal(mutationLog.length,staleWrites);
assert.equal(motionState([staleConversion]),staleBefore);
assert.ok(!mutationLog.includes('preset-write'));
console.log('Explicit conversion: single/two presets, exact timing, preflight and native-undo rollback tests passed.');

const vectorPreset=convertible('vector-preset',[presetTrack('unused','SET',[0,1],[0,1])]);
vectorPreset.animations={TRANSLATION_XY:{baseValue:{type:'VECTOR',value:{x:10,y:20}},timelineDuration:3,tracks:[{id:'vector-offset',keyframeOperation:'OFFSET',keyframes:[{id:'v0',timelinePosition:0,easing:{type:'LINEAR'},value:{type:'VECTOR',value:{x:-10,y:5}}},{id:'v1',timelinePosition:1,easing:{type:'EASE_OUT'},value:{type:'VECTOR',value:{x:0,y:0}}}]}]}};
await convert([vectorPreset]);
assert.deepEqual(JSON.parse(JSON.stringify(vectorPreset.manualKeyframeTracks.TRANSLATION_XY.keyframes.map(k=>k.value.value))),[{x:-10,y:5},{x:0,y:0}]);
const batchOne=convertible('batch-one',[presetTrack('one','SET',[0,.4],[0,1])]);
const batchTwo=convertible('batch-two',[presetTrack('batch-two:preset:0','SCALE',[0,.4],[0,1]),presetTrack('batch-two:preset:1','SCALE',[1,1.4],[1,0])]);
await convert([batchOne,batchTwo]);
assert.equal(batchOne.animationStyles.length+batchTwo.animationStyles.length,0);
assert.deepEqual(opacityValues(batchTwo),[0,1,1,0]);
const untouched=convertible('untouched-on-error',[presetTrack('u','SET',[0,1],[0,1])]);
untouched.applyManualKeyframeTrack=()=>{throw Error('Unsupported field')};
const undosBefore=undoCalls;const untouchedBefore=motionState([untouched]);
await convert([untouched]);
assert.equal(messages.at(-1).type,'plugin-error');
assert.equal(undoCalls,undosBefore,'Never undo earlier document history if the failed attempt made no changes');
assert.equal(motionState([untouched]),untouchedBefore);
console.log('Conversion vector/multi-node/no-write-failure checks passed.');

// Reduced, anonymized readback of frame 5458:108505. These are real Figma
// source tracks, including reversed track order and preset IDs unlike track IDs.
const realFixtures=JSON.parse(readFileSync(new URL('./fixtures/motion-conversion.json',import.meta.url),'utf8'));
const realNodes=realFixtures.map((fixture,i)=>{
  const n=convertible(`real-${i}`,[],0);
  n.animationStyles=structuredClone(fixture.styles);
  n.animations=structuredClone(fixture.animations);
  return n;
});
await convert(realNodes);
assert.equal(realNodes.reduce((sum,n)=>sum+n.animationStyles.length,0),0);
assert.equal(realNodes.reduce((sum,n)=>sum+Object.keys(n.manualKeyframeTracks).length,0),74);
for(let i=0;i<realNodes.length;i++) {
  const source=realFixtures[i];
  for(const [field,binding] of Object.entries(source.animations)) {
    const output=realNodes[i].manualKeyframeTracks[field].keyframes;
    const starts=binding.tracks.map(t=>source.styles.find(s=>s.id===t.animationPreset.id).timelineOffset + t.keyframes[0].timelinePosition);
    assert.equal(output[0].timelinePosition,Math.min(...starts), 'Conversion never invents an early key');
    if(field==='TRANSLATION_X'||field==='TRANSLATION_Y'||field==='ROTATION') {
      const sourceValues=binding.tracks.flatMap(t=>t.keyframes.map(k=>k.value.value));
      assert.ok(output.every(k=>sourceValues.includes(k.value.value)), 'Relative transform values must not absorb layout position');
    }
  }
}
console.log('59 real presets / 74 converted tracks retain Motion offsets and first-key timing.');

// Selection scans and conversion must not export artwork.
const artworkNode=convertible('artwork-after-convert',[presetTrack('artwork-after-convert:preset:0','SET',[0,.5],[0,1])]);
artworkNode.opacity=1;
let artworkExports=0;
artworkNode.exportAsync=async settings=>{artworkExports++;assert.equal(settings.format,'SVG_STRING');return previewSvg;};
selectForConversion([artworkNode]);
assert.equal(artworkExports,0);
await convert([artworkNode]);
await Promise.resolve();await Promise.resolve();
assert.equal(artworkExports,0);
assert.equal(messages.some(m=>m.type==='preview-images'),false);
assert.equal(artworkNode.manualKeyframeTracks.OPACITY.keyframes[0].value.value,0);
console.log('Conversion skips artwork export and preserves transparent entrance keys.');

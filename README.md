# Motion Stagger

A Figma Motion plugin for staggering and aligning editable keyframes across selected layers. Preview the timing, choose an order and easing, then apply the result to the document.

Motion Stagger runs locally. It has no analytics, account, or network access.

## Features

- Stagger tracks, layers, parent groups, or individual keyframes.
- Order from top to bottom, left to right, center outward, edges inward, or randomly; align animation starts or ends.
- Adjust span, start offset, anchor, scope, distribution easing, and keyframe easing.
- See colored timing bars on the selected frame's timeline. Hover a bar for the layer name, duration, and shift.
- Copy or paste validated settings as JSON.
- Convert compatible Motion presets to manual keyframes when direct editing is unavailable.

Controls and pasted settings update a local preview without changing the document. **Apply** writes the planned timing. **Reset** restores the session-original manual timing after Apply, or clears a pending preview before Apply. Closing the plugin leaves unapplied changes out of the document. After preset conversion, Reset restores the baked manual timing; use Figma Undo to restore the original presets.

Preset conversion is explicit. It uses the resolved animation data that Figma provides, verifies the written manual tracks, and removes the original applied presets only after successful verification. Ambiguous or conflicting tracks are rejected before writing. Presets remain read-only during ordinary preview, Apply, and Reset.

The preview and plugin window each have a resize handle. The window opens at 600 px unless a previous manual height was saved. Timing, Animation, and Other start collapsed.

## Run locally

```bash
npm install
npm run check
npm test
```

`npm test` builds `dist/code.js` and `dist/index.html`, then checks timing, Reset, preset conversion, JSON settings, and preview behavior. To build without tests, run `npm run build`. Import this project's `manifest.json` through **Figma Desktop → Plugins → Development → Import plugin from manifest…**. The manifest uses plugin ID `1683987341831983464`.

The generated `dist` directory and `node_modules` are intentionally excluded from Git. Figma Motion and its Plugin API are currently in beta, so API behavior may change.

## Tech stack

- [React](https://react.dev/) and [TypeScript](https://www.typescriptlang.org/) for the interface and plugin code
- [DialKit](https://www.dialkit.dev/) for controls
- [esbuild](https://esbuild.github.io/) for offline bundling

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0). See [LICENSE](LICENSE). Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

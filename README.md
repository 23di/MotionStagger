# Motion Stagger

Figma plugin for staggering and aligning editable Motion keyframes across selected layers. Arrange animation tracks, layers, groups, or individual keys, preview their timing on the frame timeline, and apply the result when it looks right.

Motion Stagger is completely free. Everything runs locally — no analytics, no tracking, and no network access.

## Features

- Stagger tracks, layers, parent groups, or individual keyframes
- Choose directional, center-out, edges-in, random, or selection order
- Align animation starts or ends while preserving keyframe values
- Adjust span, offset, anchor, track scope, and easing
- Preview colored timing bars with each layer's duration and shift
- Copy and paste validated settings as JSON
- Convert compatible Motion presets into editable manual keyframes

Settings change only the preview until you click **Apply**. **Reset** restores the timing from before this plugin session; after converting a preset, Figma Undo restores the original preset. Unsupported or ambiguous preset combinations are rejected before the plugin changes the document.

## Tech Stack

- [React](https://react.dev/) — plugin interface
- [DialKit](https://www.dialkit.dev/) — controls
- [TypeScript](https://www.typescriptlang.org/) — application code
- [esbuild](https://esbuild.github.io/) — offline build tooling

To run locally, use `npm ci && npm run build`, then import `manifest.json` through **Figma Desktop → Plugins → Development → Import plugin from manifest…**. Run `npm run check` and `npm test` to validate changes. Build output and installed dependencies are excluded from Git.

## You can also try

[Motion Loops — Create editable looping animations in Figma Motion](https://github.com/23di/MotionLoops).

## License

This project is licensed under the Creative Commons Attribution-NonCommercial 4.0 International License (CC BY-NC 4.0). See [LICENSE](LICENSE) for the full license text. Third-party license notices are in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

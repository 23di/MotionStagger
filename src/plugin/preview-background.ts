// Render only the frame's paints. No clone, temporary node, or document export:
// exporting the frame itself would duplicate every animated child in the preview.
export function previewBackground(fills: readonly Paint[], opacity = 1): string | undefined {
  const rgb = (color: RGB) => `rgb(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)})`;
  const layers: string[] = [];
  for (const [index, paint] of [...fills].reverse().entries()) {
    if (paint.visible === false) continue;
    const alpha = paint.opacity ?? 1;
    const blend = paint.blendMode && paint.blendMode !== "NORMAL" ? ` style="mix-blend-mode:${paint.blendMode.toLowerCase().replace(/_/g, "-")}"` : "";
    if (paint.type === "SOLID") {
      layers.push(`<rect width="1" height="1" fill="${rgb(paint.color)}" opacity="${alpha}"${blend}/>`);
    } else if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") {
      const [[a, c, e], [b, d, f]] = paint.gradientTransform;
      const det = a * d - b * c;
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) continue;
      const matrix = [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
      const tag = paint.type === "GRADIENT_LINEAR" ? "linearGradient" : "radialGradient";
      const geometry = paint.type === "GRADIENT_LINEAR" ? 'x1="0" y1="0.5" x2="1" y2="0.5"' : 'cx="0.5" cy="0.5" r="0.5"';
      const stops = paint.gradientStops.map(stop => `<stop offset="${stop.position}" stop-color="${rgb(stop.color)}" stop-opacity="${stop.color.a}"/>`).join("");
      layers.push(`<defs><${tag} id="paint${index}" gradientUnits="userSpaceOnUse" ${geometry} gradientTransform="matrix(${matrix.join(" ")})">${stops}</${tag}></defs><rect width="1" height="1" fill="url(#paint${index})" opacity="${alpha}"${blend}/>`);
    }
  }
  return layers.length ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none"><g opacity="${opacity}">${layers.join("")}</g></svg>` : undefined;
}

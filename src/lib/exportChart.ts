// Exports a rendered recharts <svg> node as a real image file — no charting
// library re-render, no server round-trip: recharts already draws real SVG,
// so this just serializes what's on screen. PNG rasterizes onto a canvas
// (2x scale for a crisp export); SVG downloads the serialized markup as-is.

function serialize(svgEl: SVGSVGElement): string {
  return new XMLSerializer().serializeToString(svgEl);
}

export function downloadSvg(svgEl: SVGSVGElement, filename: string): void {
  const blob = new Blob([serialize(svgEl)], { type: "image/svg+xml;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export async function downloadPng(svgEl: SVGSVGElement, filename: string, bgColor: string, scale = 2): Promise<void> {
  const source = serialize(svgEl);
  const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Could not rasterize chart"));
      img.src = url;
    });
    const rect = svgEl.getBoundingClientRect();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.drawImage(img, 0, 0, rect.width, rect.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Could not encode PNG");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } finally {
    URL.revokeObjectURL(url);
  }
}

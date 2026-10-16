export function fitPreviewPaper(paperWidth: number, availableWidth: number): number {
  if (!Number.isFinite(paperWidth) || paperWidth <= 0) return 1;
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  return Math.min(1, availableWidth / paperWidth);
}

// The designer owns scrolling and zoom. Start editing with the whole paper in
// view, then leave its own zoom controls available for detail work.
export function fitDesignerZoom(paperWidth: number, hostWidth: number, currentZoom = 1): number {
  if (!Number.isFinite(paperWidth) || paperWidth <= 0) return currentZoom;
  if (!Number.isFinite(hostWidth) || hostWidth <= 0) return currentZoom;
  const availableWidth = Math.max(0, hostWidth - 93); // rail + canvas padding + scrollbar
  const fit = Math.floor((availableWidth / paperWidth) * 20) / 20;
  return Math.max(0.2, Math.min(currentZoom, fit));
}

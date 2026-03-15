export interface ViewerTransformState {
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  scale: number;
  positionX: number;
  positionY: number;
}

export function normalizeRotation(rotation: number): number {
  const normalized = rotation % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

export function rotateBy(rotation: number, delta: number): number {
  return normalizeRotation(rotation + delta);
}

export function buildViewerTransform(state: ViewerTransformState): string {
  const scaleX = state.flipX ? -state.scale : state.scale;
  const scaleY = state.flipY ? -state.scale : state.scale;
  return `rotate(${normalizeRotation(state.rotation)}deg) scale(${scaleX}, ${scaleY}) translate(${state.positionX / state.scale}px, ${state.positionY / state.scale}px)`;
}

export function getComparablePreviewUrl(urls: {
  previewUrl?: string;
  sampleUrl?: string;
  fileUrl?: string;
}): string {
  return urls.sampleUrl || urls.previewUrl || urls.fileUrl || '';
}

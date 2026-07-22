const EPSILON = 1e-9;

const finitePositive = (value, fallback = 0) => Number.isFinite(value) && value > 0 ? value : fallback;
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const stableCompare = (left, right) => left < right ? -1 : (left > right ? 1 : 0);

export const ADAPTIVE_HIT_POLICY = Object.freeze({
  touch: Object.freeze({ minimumRadiusPx: 28, maximumRadiusPx: 48, paddingPx: 10 }),
  pen: Object.freeze({ minimumRadiusPx: 18, maximumRadiusPx: 36, paddingPx: 6 })
});

export const resolveViewportHeightCssPx = ({
  viewportHeightCssPx,
  renderBufferHeightPx,
  rendererPixelRatio,
  devicePixelRatio
} = {}) => {
  if (finitePositive(viewportHeightCssPx)) return viewportHeightCssPx;
  const pixelRatio = finitePositive(rendererPixelRatio, finitePositive(devicePixelRatio, 1));
  const renderHeight = finitePositive(renderBufferHeightPx);
  return renderHeight ? renderHeight / pixelRatio : 0;
};

export const calculateProjectedNodeRadiusPx = ({
  geometryRadius = 0,
  worldScale = 1,
  cameraDistance = 0,
  cameraType = 'perspective',
  verticalFovDegrees = 75,
  cameraZoom = 1,
  orthographicTop = 1,
  orthographicBottom = -1,
  viewportHeightCssPx,
  renderBufferHeightPx,
  rendererPixelRatio,
  devicePixelRatio
} = {}) => {
  const localRadius = finitePositive(Math.abs(geometryRadius));
  const scale = finitePositive(Math.abs(worldScale));
  const viewportHeight = resolveViewportHeightCssPx({
    viewportHeightCssPx,
    renderBufferHeightPx,
    rendererPixelRatio,
    devicePixelRatio
  });
  if (!localRadius || !scale || !viewportHeight) return 0;

  const worldRadius = localRadius * scale;
  const zoom = finitePositive(cameraZoom, 1);
  if (cameraType === 'orthographic') {
    const visibleHeight = Math.abs(orthographicTop - orthographicBottom) / zoom;
    return visibleHeight > EPSILON ? worldRadius * (viewportHeight / visibleHeight) : 0;
  }

  const distance = finitePositive(cameraDistance);
  const fieldOfView = finitePositive(verticalFovDegrees);
  if (!distance || !fieldOfView) return 0;
  const tangent = Math.tan((fieldOfView * Math.PI) / 360);
  if (!(tangent > EPSILON)) return 0;
  const visibleHeight = (2 * distance * tangent) / zoom;
  return worldRadius * (viewportHeight / visibleHeight);
};

export const calculateAdaptiveHitRadiusPx = ({
  projectedRadiusPx = 0,
  pointerType = 'touch',
  policy = ADAPTIVE_HIT_POLICY
} = {}) => {
  const projected = Math.max(0, Number.isFinite(projectedRadiusPx) ? projectedRadiusPx : 0);
  const rule = policy[pointerType];
  if (!rule) return projected;
  const expanded = clamp(
    projected + rule.paddingPx,
    rule.minimumRadiusPx,
    rule.maximumRadiusPx
  );
  return Math.max(projected, expanded);
};

export const calculateNormalizedBoundaryDistance = ({
  centerDistancePx,
  projectedRadiusPx,
  effectiveRadiusPx
} = {}) => {
  const centerDistance = Math.max(0, Number.isFinite(centerDistancePx) ? centerDistancePx : Infinity);
  const projected = Math.max(0, Number.isFinite(projectedRadiusPx) ? projectedRadiusPx : 0);
  const effective = Math.max(projected, Number.isFinite(effectiveRadiusPx) ? effectiveRadiusPx : projected);
  const acquisitionBand = Math.max(1, effective - projected);
  return Math.max(0, centerDistance - projected) / acquisitionBand;
};

export const selectAdaptiveHitCandidate = (candidates = []) => {
  const qualified = candidates
    .filter((candidate) => Number.isFinite(candidate.centerDistancePx)
      && Number.isFinite(candidate.projectedRadiusPx)
      && Number.isFinite(candidate.effectiveRadiusPx)
      && candidate.centerDistancePx <= candidate.effectiveRadiusPx)
    .map((candidate) => ({
      ...candidate,
      normalizedBoundaryDistance: calculateNormalizedBoundaryDistance(candidate)
    }));

  qualified.sort((left, right) => {
    const boundaryDelta = left.normalizedBoundaryDistance - right.normalizedBoundaryDistance;
    if (Math.abs(boundaryDelta) > EPSILON) return boundaryDelta;
    const leftDepth = Number.isFinite(left.depth) ? left.depth : Infinity;
    const rightDepth = Number.isFinite(right.depth) ? right.depth : Infinity;
    if (Math.abs(leftDepth - rightDepth) > EPSILON) return leftDepth - rightDepth;
    return stableCompare(String(left.nodeId), String(right.nodeId));
  });

  return qualified[0] ?? null;
};

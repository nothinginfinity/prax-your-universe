const cloneVector = (value = {}) => Object.freeze({
  x: Number(value.x) || 0,
  y: Number(value.y) || 0,
  z: Number(value.z) || 0
});

export const cloneCameraState = (state = {}) => Object.freeze({
  position: cloneVector(state.position),
  target: cloneVector(state.target),
  graphRotation: cloneVector(state.graphRotation)
});

export const captureCameraState = (camera, controls, graphGroup) => cloneCameraState({
  position: camera?.position,
  target: controls?.target,
  graphRotation: graphGroup?.rotation
});

export const createNodeCameraState = (nodePosition, currentState, { distance = 8 } = {}) => {
  const target = cloneVector(nodePosition);
  const current = cloneCameraState(currentState);
  const offset = {
    x: current.position.x - current.target.x,
    y: current.position.y - current.target.y,
    z: current.position.z - current.target.z
  };
  const length = Math.hypot(offset.x, offset.y, offset.z);
  const direction = length > 0.0001
    ? { x: offset.x / length, y: offset.y / length, z: offset.z / length }
    : { x: 0, y: 0, z: 1 };
  const safeDistance = Number.isFinite(distance) && distance > 0 ? distance : 8;
  return cloneCameraState({
    position: {
      x: target.x + direction.x * safeDistance,
      y: target.y + direction.y * safeDistance,
      z: target.z + direction.z * safeDistance
    },
    target,
    graphRotation: current.graphRotation
  });
};

export const interpolateCameraState = (fromState, toState, progress) => {
  const from = cloneCameraState(fromState);
  const to = cloneCameraState(toState);
  const amount = Math.min(1, Math.max(0, Number(progress) || 0));
  const interpolateVector = (fromVector, toVector) => ({
    x: fromVector.x + (toVector.x - fromVector.x) * amount,
    y: fromVector.y + (toVector.y - fromVector.y) * amount,
    z: fromVector.z + (toVector.z - fromVector.z) * amount
  });
  return cloneCameraState({
    position: interpolateVector(from.position, to.position),
    target: interpolateVector(from.target, to.target),
    graphRotation: interpolateVector(from.graphRotation, to.graphRotation)
  });
};

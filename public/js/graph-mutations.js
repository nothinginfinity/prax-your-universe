export const commitGraphMutation = async ({
  store,
  repository = null,
  mutate,
  project
}) => {
  const previousSnapshot = store.snapshot();
  let result;
  try {
    result = mutate();
    const nextSnapshot = store.snapshot();
    if (repository) await repository.saveSnapshot(nextSnapshot);
  } catch (error) {
    store.replaceSnapshot(previousSnapshot);
    throw error;
  }
  project?.(result);
  return result;
};

export const commitGraphReplacement = async ({
  store,
  repository = null,
  snapshot,
  project
}) => {
  const previousSnapshot = store.snapshot();
  let nextSnapshot;
  try {
    nextSnapshot = store.replaceSnapshot(snapshot);
    if (repository) await repository.saveSnapshot(nextSnapshot);
  } catch (error) {
    store.replaceSnapshot(previousSnapshot);
    throw error;
  }

  try {
    await project?.(nextSnapshot, { phase: 'commit' });
    return nextSnapshot;
  } catch (projectionError) {
    const rollbackErrors = [];
    try {
      store.replaceSnapshot(previousSnapshot);
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (repository) {
      try {
        await repository.saveSnapshot(previousSnapshot);
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    try {
      await project?.(previousSnapshot, { phase: 'rollback' });
    } catch (error) {
      rollbackErrors.push(error);
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [projectionError, ...rollbackErrors],
        'Graph replacement projection failed and rollback was incomplete.'
      );
    }
    throw projectionError;
  }
};

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

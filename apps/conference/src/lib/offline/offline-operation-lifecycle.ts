const privateOperationControllers = new Set<AbortController>();

export const trackParticipantPrivateOperation = (
  controller: AbortController,
): (() => void) => {
  privateOperationControllers.add(controller);
  return () => privateOperationControllers.delete(controller);
};

export const abortParticipantPrivateOperations = (): void => {
  for (const controller of privateOperationControllers) controller.abort();
  privateOperationControllers.clear();
};

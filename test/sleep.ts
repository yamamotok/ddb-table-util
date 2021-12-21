/**
 * Sleep. Usually used for waiting DynamoDB write completion.
 * @param duration duration in milli-second
 */
export const sleep = async (duration?: number): Promise<void> => {
  duration = duration || 100;
  return new Promise((resolve) => setTimeout(resolve, duration));
};

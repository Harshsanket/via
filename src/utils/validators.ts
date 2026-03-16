export const areValidStrings = (...values: unknown[]): boolean => {
  return values.every(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
};

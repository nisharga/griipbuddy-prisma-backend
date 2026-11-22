/** Copy only the given keys from an object (e.g. whitelisting request-body fields). */
const pick = <T extends Record<string, unknown>, K extends keyof T>(
  obj: T | undefined,
  keys: readonly K[]
): Partial<T> => {
  const finalObj: Partial<T> = {};
  for (const key of keys) {
    if (obj && Object.hasOwnProperty.call(obj, key) && obj[key] !== undefined) finalObj[key] = obj[key];
  }
  return finalObj;
};

export default pick;

export const isPlainObject = (value) => value !== null && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export const validString = (value) => typeof value === 'string' && value.trim().length > 0
  && !value.includes('\0');

export const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member);
  }
  return value;
};

// Both stages share shape rules but retain their distinct public error classes.
export const createShapeValidators = (ErrorClass) => {
  const fail = (code) => { throw new ErrorClass(code); };
  const exactObject = (value, keys, code) => {
    if (!isPlainObject(value) || Object.keys(value).length !== keys.length
      || keys.some((key) => !Object.hasOwn(value, key))
      || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
    return value;
  };
  const denseArray = (value, minimum, code) => {
    if (!Array.isArray(value) || value.length < minimum || Object.keys(value).length !== value.length) fail(code);
    for (let index = 0; index < value.length; index += 1) if (!Object.hasOwn(value, index)) fail(code);
    return value;
  };
  return { fail, exactObject, denseArray };
};

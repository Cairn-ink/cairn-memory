// Models are stateless: tentative trials receive the number of committed bodies.
export function scalarCost(overhead) {
  if (!Number.isSafeInteger(overhead) || overhead < 0) throw new Error('invalid_assembly_budget');
  return { id: 'scalar', initial: 0, unit: unit => unit.tokens + overhead };
}

export function hostV2Cost({ constants, bodyTokens }) {
  return { id: 'host-v2', initial: constants.envelope,
    unit: (unit, item, body, bodies) => body ? unit.tokens + (bodies === 0 ? constants.h1 : constants.hN)
      : unit.text === item.body.text ? constants.aliasSource : constants.concreteSource - bodyTokens + unit.tokens };
}

// Model-facing synthetic sources only. Evaluator anchors live in rubric.mjs.
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const user = content => ({ role: 'user', content });
const assistant = content => ({ role: 'assistant', content });
const sources = [
  [user('On Tuesday I repaired my blue handcart beside Alder Dock.'),
    assistant('A repaired handcart can benefit from a careful inspection. Check wheel alignment on a level surface. ' +
      'Examine fasteners for looseness and verify handle clearance before loading. ' +
      'Put heavier cargo low and near the axle, and secure anything that can slide. ' +
      'A short unloaded roll can reveal wheel wobble; stop if the handle pulls to one side. ' +
      'Avoid steep wet ramps until you know the brake response. Keep a dated maintenance note, ' +
      'but do not treat these recommendations as repairs you have already performed.')],
  [user('Ordinary background '.repeat(39) +
    'After lunch I took the orchard tram from Pine Gate to Cedar Square with Mei. ' +
    'The platform sign also displayed 樹園 🚋.'), assistant('Keep any travel note concise.')],
  [user('Yesterday I mapped the footpath from Moss Lane to Quarry Bend.'),
    user('This morning I lent my copper watering can to Nia.'), assistant('Those are separate activities.')],
  [user('On Monday I patched the violet kite at Fern Field.'),
    user('On Tuesday I delivered a bread tin to Otter Hall.'),
    user('On Wednesday I planted sage beside Brook Steps.'),
    user('On Thursday I painted the pantry latch turquoise.'),
    user('On Friday I returned the folding stool to Lio.'),
    assistant('Organizing notes can help. A kite patch should dry before the fabric is tensioned. ' +
      'A bread tin is easier to transport with its lid secured. Newly planted sage usually benefits ' +
      'from checking soil moisture rather than watering on a rigid schedule. Pantry paint should cure ' +
      'before the latch is handled frequently. Folding stools should have their hinges checked before use. ' +
      'These are general suggestions about the activities, not additional tasks you reported completing.')],
  Array.from({ length: 21 }, (_, index) => user(
    `On survey day ${index + 1} I installed marker ${index + 1} in separate plot ${index + 1}.`)),
  [user('I did not renew the shed permit. I might apply again only if the fee falls.'),
    assistant('You could compare the fee schedule before deciding.')],
  [user('My neighbor Ivo said, "I bought a red canoe." I only repeated his story; I did not buy it.'),
    assistant('That quotation concerns Ivo, not your purchase.')],
  [user('If the hill clinic opens, I might volunteer there; I have not accepted any assignment.'),
    assistant('A ferry schedule could help if you later choose to volunteer.')],
  [user('I need options for storing a spare key.'), assistant('One proposal is the station desk locker.'),
    user('I have not chosen that proposal or authorized anyone to store the key.')],
  [assistant('You could label the north shelf "tools".'),
    user('I adopt that north-shelf labeling plan for next week; I have not labeled it yet.')],
  [assistant('For a ceramic pot, place a drainage mesh over the hole before adding soil.'),
    assistant('The mesh can reduce soil loss while allowing water to drain.')],
  [assistant('For a tire-pressure check, use the pressure range printed on the tire sidewall; do not exceed it. Your orange bicycle would suit the arcade route.'),
    user('Correction: my vehicle is a green scooter, not an orange bicycle.'),
    user('I rode that green scooter to Birch Arcade yesterday (白樺 🛵).')],
];

export const sourceRoleCases = freeze(sources.map((messages, index) => {
  const ordinal = index + 1, tag = `n28-c${String(ordinal).padStart(2, '0')}`;
  return { ordinal, capture: { namespace: { ownerId: 'source-role-offline', scope: 'personal', projectId: null },
    client: 'source-role-offline', eventId: `${tag}-batch`, sessionId: `${tag}-session`,
    messages: messages.map((message, position) => ({ id: `${tag}-m${position + 1}`, ...message })) } };
}));

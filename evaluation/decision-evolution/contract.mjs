// Offline diagnostic contract. Source data and evaluator expectations are deliberately separate.
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...allowed].sort().join('|');
const text = (value) => typeof value === 'string' && value.length > 0;
const unique = (values) => new Set(values).size === values.length;
const equalSet = (actual, expected) => Array.isArray(actual)
  && unique(actual) && actual.length === expected.length
  && actual.every((item) => expected.includes(item));
const keyOfEdge = (edge) => `${edge.from}\u0000${edge.to}\u0000${edge.type}`;
const failure = (message) => { throw new TypeError(message); };

export function validateFixture(fixture) {
  if (!keys(fixture, ['version', 'cases']) || fixture.version !== 'decision-evolution-fixture-v1'
    || !Array.isArray(fixture.cases) || fixture.cases.length === 0) failure('invalid fixture');
  const caseIds = [];
  const questionIds = [];
  const eventIds = [];
  for (const item of fixture.cases) {
    if (!keys(item, ['id', 'split', 'language', 'events', 'questions']) || !text(item.id)
      || !['dev', 'heldout'].includes(item.split) || !['en', 'zh-TW'].includes(item.language)
      || !Array.isArray(item.events) || item.events.length === 0
      || !Array.isArray(item.questions) || item.questions.length === 0) failure('invalid case');
    caseIds.push(item.id);
    for (const event of item.events) {
      if (!keys(event, ['id', 'occurredAt', 'ingestedAt', 'actor', 'text'])
        || ![event.id, event.occurredAt, event.ingestedAt, event.actor, event.text].every(text)
        || !/^\d{4}-\d{2}-\d{2}$/.test(event.occurredAt)
        || !/^\d{4}-\d{2}-\d{2}$/.test(event.ingestedAt)) failure('invalid event');
      eventIds.push(event.id);
    }
    for (const question of item.questions) {
      if (!keys(question, ['id', 'actor', 'text'])
        || ![question.id, question.actor, question.text].every(text)
        || !item.events.some((event) => event.actor === question.actor)) failure('invalid question');
      questionIds.push(question.id);
    }
  }
  if (![caseIds, questionIds, eventIds].every(unique)) failure('duplicate source id');
  return true;
}

export async function runDecisionEvolution({ fixture, answer, split = 'all' }) {
  validateFixture(fixture);
  if (typeof answer !== 'function' || !['all', 'dev', 'heldout'].includes(split)) failure('invalid run options');
  const responses = [];
  for (const item of fixture.cases.filter((entry) => split === 'all' || entry.split === split)) {
    for (const question of item.questions) {
      // The callback sees only the source event/question projection, never a rubric or expected graph.
      const input = structuredClone({ caseId: item.id, language: item.language,
        events: item.events, question });
      let response;
      try { response = await answer(input); }
      catch { response = { status: 'unknown' }; }
      responses.push({ caseId: item.id, questionId: question.id, response });
    }
  }
  return { fixtureVersion: fixture.version, responses };
}

function validExpectation(expected, item, question) {
  if (!keys(expected, ['caseId', 'questionId', 'state', 'evidence', 'nonFinal', 'reasons', 'updates'])
    || expected.caseId !== item.id || expected.questionId !== question.id
    || !validState(expected.state) || expected.state.actor !== question.actor
    || !Array.isArray(expected.evidence) || !Array.isArray(expected.nonFinal)
    || !Array.isArray(expected.reasons) || !Array.isArray(expected.updates)) return false;
  const eventById = new Map(item.events.map((event) => [event.id, event]));
  const owned = (ids) => Array.isArray(ids) && unique(ids)
    && ids.every((id) => eventById.get(id)?.actor === question.actor);
  const present = (ids) => Array.isArray(ids) && unique(ids)
    && ids.every((id) => eventById.has(id));
  return present(expected.evidence)
    && expected.nonFinal.every((entry) => validNonFinal(entry, owned))
    && expected.reasons.every((reason) => validReason(reason, owned))
    && expected.updates.every((edge) => validEdge(edge, owned));
}

function validState(state) {
  return keys(state, ['actor', 'choice', 'commitment', 'basis'])
    && text(state.actor) && text(state.choice)
    && ['adopted', 'tentative', 'undecided'].includes(state.commitment)
    && ['supported', 'needs_reconfirmation', 'partially_challenged', 'not_stated'].includes(state.basis);
}
function validNonFinal(entry, owned) {
  return keys(entry, ['choice', 'stage', 'evidence']) && text(entry.choice)
    && ['considering', 'tentative'].includes(entry.stage) && owned(entry.evidence);
}
function validReason(reason, owned) {
  return keys(reason, ['label', 'status', 'evidence']) && text(reason.label)
    && ['active', 'challenged'].includes(reason.status) && owned(reason.evidence);
}
function validEdge(edge, owned) {
  return keys(edge, ['from', 'to', 'type']) && edge.type === 'supersedes'
    && edge.from !== edge.to && owned([edge.from, edge.to]);
}

export function scoreDecisionEvolution({ fixture, rubric, run }) {
  validateFixture(fixture);
  if (!keys(rubric, ['version', 'fixtureVersion', 'expectations'])
    || rubric.version !== 'decision-evolution-rubric-v1'
    || rubric.fixtureVersion !== fixture.version || !Array.isArray(rubric.expectations)
    || !keys(run, ['fixtureVersion', 'responses']) || run.fixtureVersion !== fixture.version
    || !Array.isArray(run.responses)) failure('invalid scorer inputs');
  const sourceQuestions = fixture.cases.flatMap((item) => item.questions.map((question) => ({ item, question })));
  const expectedById = new Map();
  for (const expected of rubric.expectations) {
    const source = sourceQuestions.find(({ item, question }) => item.id === expected.caseId
      && question.id === expected.questionId);
    if (!source || !validExpectation(expected, source.item, source.question)
      || expectedById.has(expected.questionId)) failure('invalid rubric');
    expectedById.set(expected.questionId, expected);
  }
  if (expectedById.size !== sourceQuestions.length) failure('incomplete rubric');
  const seen = new Set();
  const results = run.responses.map(({ caseId, questionId, response }) => {
    const source = sourceQuestions.find(({ item, question }) => item.id === caseId
      && question.id === questionId);
    if (!source || seen.has(questionId)) failure('invalid run response identity');
    seen.add(questionId);
    const expected = expectedById.get(questionId);
    if (keys(response, ['status']) && ['unknown', 'incomplete'].includes(response.status)) {
      return { caseId, questionId, split: source.item.split, outcome: response.status,
        checks: null };
    }
    const caseIds = new Set(source.item.events.map((event) => event.id));
    const ownedIds = new Set(source.item.events.filter((event) => event.actor === source.question.actor)
      .map((event) => event.id));
    const attributedIds = [...(Array.isArray(response?.nonFinal)
      ? response.nonFinal.map((entry) => entry?.evidence) : []), ...(Array.isArray(response?.reasons)
      ? response.reasons.map((reason) => reason?.evidence) : []), ...(Array.isArray(response?.updates)
      ? response.updates.map((edge) => [edge?.from, edge?.to]) : [])]
      .flat().filter((id) => typeof id === 'string');
    const suppliedIds = [...(Array.isArray(response?.evidence) ? response.evidence : []),
      ...attributedIds];
    const shape = keys(response, ['status', 'state', 'evidence', 'nonFinal', 'reasons', 'updates'])
      && response.status === 'answered' && validState(response.state)
      && Array.isArray(response.evidence) && unique(response.evidence)
      && Array.isArray(response.nonFinal) && response.nonFinal.every((entry) => validNonFinal(entry,
        (ids) => Array.isArray(ids) && unique(ids) && ids.every(text)))
      && Array.isArray(response.reasons) && response.reasons.every((reason) => validReason(reason,
        (ids) => Array.isArray(ids) && unique(ids) && ids.every(text)))
      && Array.isArray(response.updates) && response.updates.every((edge) => validEdge(edge,
        (ids) => ids.every(text)));
    const checks = {
      shape: Boolean(shape),
      sourceScope: suppliedIds.every((id) => caseIds.has(id)),
      actorScope: response?.state?.actor === source.question.actor
        && attributedIds.every((id) => ownedIds.has(id)),
      state: Boolean(shape && ['actor', 'choice', 'commitment', 'basis']
        .every((field) => response.state[field] === expected.state[field])),
      evidence: Boolean(shape && equalSet(response.evidence, expected.evidence)),
      nonFinal: Boolean(shape && equalSet(response.nonFinal.map((entry) => JSON.stringify({
        choice: entry.choice, stage: entry.stage, evidence: [...entry.evidence].sort(),
      })), expected.nonFinal.map((entry) => JSON.stringify({
        choice: entry.choice, stage: entry.stage, evidence: [...entry.evidence].sort(),
      })))),
      reasons: Boolean(shape && equalSet(response.reasons.map((reason) => JSON.stringify({
        label: reason.label, status: reason.status, evidence: [...reason.evidence].sort(),
      })), expected.reasons.map((reason) => JSON.stringify({
        label: reason.label, status: reason.status, evidence: [...reason.evidence].sort(),
      })))),
      updates: Boolean(shape && equalSet(response.updates.map(keyOfEdge), expected.updates.map(keyOfEdge))),
    };
    return { caseId, questionId, split: source.item.split,
      outcome: Object.values(checks).every(Boolean) ? 'diagnostic_pass' : 'diagnostic_fail', checks };
  });
  for (const { question } of sourceQuestions) if (!seen.has(question.id)) {
    results.push({ caseId: expectedById.get(question.id).caseId, questionId: question.id,
      split: fixture.cases.find((item) => item.id === expectedById.get(question.id).caseId).split,
      outcome: 'incomplete', checks: null });
  }
  const counts = Object.fromEntries(['diagnostic_pass', 'diagnostic_fail', 'unknown', 'incomplete']
    .map((outcome) => [outcome, results.filter((result) => result.outcome === outcome).length]));
  return { diagnosticOnly: true, counts, results };
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { boundedText } from '../../../core/validation.mjs';

const fixtureText = readFileSync(new URL('../rationale-disposition-fixture.json', import.meta.url), 'utf8');
const rubric = readFileSync(new URL('../../../docs/rationale-disposition-rubric.md', import.meta.url), 'utf8');
const fixture = JSON.parse(fixtureText);
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const dense = value => Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
  Object.keys(value).length === value.length &&
  Array.from({ length: value.length }, (_, index) => index).every(index => Object.hasOwn(value, index));
const wellFormed = value => {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return false;
  }
  return true;
};

function validate(value) {
  assert.ok(exact(value, ['cases']));
  assert.ok(dense(value.cases));
  assert.equal(value.cases.length, 6);
  const eventIds = new Set();
  for (const [caseIndex, scenario] of value.cases.entries()) {
    assert.ok(exact(scenario, ['id', 'events', 'oldEdges']));
    assert.equal(scenario.id, `scenario-0${caseIndex + 1}`);
    assert.ok(dense(scenario.events));
    assert.ok(scenario.events.length >= 1 && scenario.events.length <= 6);
    for (const [eventIndex, event] of scenario.events.entries()) {
      assert.ok(exact(event, ['id', 'role', 'text']));
      assert.equal(event.id, `s${caseIndex + 1}-e${eventIndex + 1}`);
      assert.equal(eventIds.has(event.id), false);
      eventIds.add(event.id);
      assert.ok(['user', 'assistant'].includes(event.role));
      assert.equal(typeof event.text, 'string');
      assert.ok(event.text.length >= 1 && event.text.length <= 800);
      assert.ok(event.text.length <= 4000); // Core memory content admission bound.
      assert.equal(event.text, boundedText(event.text, 800));
      assert.equal(event.text, boundedText(event.text, 4000));
      assert.equal(wellFormed(event.text), true);
    }
    assert.ok(dense(scenario.oldEdges));
    assert.ok(scenario.oldEdges.length >= 1 && scenario.oldEdges.length <= 10);
    const tuples = new Set();
    for (const edge of scenario.oldEdges) {
      assert.ok(exact(edge, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt']));
      assert.ok(['supports-decision', 'challenges-premise'].includes(edge.relation));
      for (const endpoint of ['from', 'to']) {
        assert.ok(Number.isSafeInteger(edge[endpoint]) && edge[endpoint] >= 0 &&
          edge[endpoint] < scenario.events.length);
      }
      assert.equal(edge.fromReceipt, 0);
      assert.equal(edge.toReceipt, 0);
      if (edge.relation === 'challenges-premise') assert.notEqual(edge.from, edge.to);
      const tuple = JSON.stringify([edge.from, edge.to, edge.relation,
        edge.fromReceipt, edge.toReceipt]);
      assert.equal(tuples.has(tuple), false);
      tuples.add(tuple);
    }
  }
  return true;
}

test('DF1–2 six source-only cases stay dense, bounded, normalized and reference-safe', () => {
  assert.equal(validate(fixture), true);
  assert.deepEqual(fixture.cases.map(item => item.events.length), [4, 4, 4, 4, 5, 3]);
  assert.deepEqual(fixture.cases.map(item => item.oldEdges.length), [3, 2, 3, 2, 3, 1]);
  assert.equal(fixture.cases[4].events[2].role, 'assistant');
  assert.equal(fixture.cases.flatMap(item => item.events).filter(item => item.role === 'assistant').length, 1);
  assert.match(fixture.cases[1].events[3].text, /September 1 is the import date, not a new test date/u);
  assert.match(fixture.cases[4].events[1].text, /price was not a reason/u);
  assert.match(fixture.cases[5].events[2].text, /no longer have notes/u);
});

test('DF2–3 evaluator rubric is separate and source references cover every old tuple', () => {
  assert.equal(fixtureText.includes('"expected"'), false);
  assert.equal(fixtureText.includes('"requiredNew"'), false);
  assert.equal(fixtureText.includes('"notes"'), false);
  assert.match(rubric, /not model input/u);
  for (const [index, scenario] of fixture.cases.entries()) {
    const heading = `## Scenario 0${index + 1}`;
    const section = rubric.split(heading)[1]?.split('\n## ')[0];
    assert.ok(section, heading);
    for (const edge of scenario.oldEdges) {
      const label = `${edge.from} → ${edge.to} ${edge.relation === 'supports-decision' ? 'support' : 'challenge'}`;
      assert.ok(section.includes(`| ${label} |`), `${heading}: ${label}`);
    }
  }
});

test('DF6 malformed rows, roles, text, indices and duplicate tuples are rejected', () => {
  const cases = [
    value => { value.cases[0].events.length = 5; },
    value => { value.cases[0].events[0].role = 'system'; },
    value => { value.cases[0].events[0].text = 'x'.repeat(801); },
    value => { value.cases[0].events[0].text = '\uD800'; },
    value => { value.cases[0].events[0].text = 'e\u0301'; },
    value => { value.cases[0].events[0].text = 'Ｆｕｌｌｗｉｄｔｈ'; },
    value => { value.cases[0].events[0].text = 'Two  spaces'; },
    value => { value.cases[0].events[0].text += '\r'; },
    value => { value.cases[0].events[0].expected = 'keep'; },
    value => { value.cases[0].id = 'keep-this-edge'; },
    value => { value.cases[0].oldEdges[0].to = 99; },
    value => { value.cases[0].oldEdges[0].fromReceipt = 1; },
    value => { value.cases[0].oldEdges[2].to = value.cases[0].oldEdges[2].from; },
    value => { value.cases[0].oldEdges.push({ ...value.cases[0].oldEdges[0] }); },
    value => { const edge = value.cases[0].oldEdges[0]; value.cases[0].oldEdges.push({
      relation: edge.relation, to: edge.to, from: edge.from,
      toReceipt: edge.toReceipt, fromReceipt: edge.fromReceipt }); },
    value => { value.cases[0].oldEdges[0].interpretationStatus = 'verified'; },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(fixture);
    mutate(copy);
    assert.throws(() => validate(copy));
  }
});

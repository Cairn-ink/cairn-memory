import test from 'node:test';
import { legacyDeadlineControl } from '../testing/card-current-deadline-fixture.mjs';
for (const schema33 of [false, true]) for (const stage of ['before-preparation', 'between-candidates'])
  test(`C26 frozen no-declaration facade bytes survive ${stage}; schema ${schema33 ? 33 : 32}`, async t => {
    await legacyDeadlineControl(t, { stage, schema33 });
  });

import { createHash } from 'node:crypto';
import { captureSnapshot, retainedSourceView } from './capture-input.mjs';
import { episodeText } from './episode-storage.mjs';
import { denseArray, fail, identifier, object } from './validation.mjs';

export function episodeInstant(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid_input');
  return value;
}

/** Identity and clocks stay local. The ordinary v2 canonicalization is unchanged. */
export function episodeSnapshot(input) {
  try {
    object(input, ['namespace','client','eventId','sessionId','messages','episodeContext']);
    object(input.episodeContext, ['clientLabel','generation','origin']);
    const { clientLabel, generation, origin } = input.episodeContext;
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(input.client) || !['ordinary','precompact'].includes(origin)) fail('invalid_input');
    const context = { clientLabel: episodeText(clientLabel, 80), generation: identifier(generation), origin };
    const times = [];
    const messages = denseArray(input.messages, 1, 24).map(message => {
      object(message, ['id','role','content','occurredAt']);
      times.push(episodeInstant(message.occurredAt));
      return { id: message.id, role: message.role, content: message.content };
    });
    const snapshot = captureSnapshot({ ...input, messages }, 'source-bound-v2');
    snapshot.episodeContext = context;
    snapshot.messages = snapshot.messages.map((message, index) => ({ ...message, occurredAt: times[index] }));
    snapshot.payloadDigest = createHash('sha256').update(JSON.stringify(['cairn.capture.episode.v1',
      snapshot.payloadDigest, context, times])).digest('hex');
    snapshot.sessionEpisodes = 'episode-v1';
    const known = times.filter(time => time !== null).sort();
    snapshot.eventStart = known[0] ?? null;
    snapshot.eventEnd = known.at(-1) ?? null;
    snapshot.eventTimeCoverage = known.length === times.length ? 'complete' : known.length ? 'partial' : 'unknown';
    // Staged text has the established v2 shape; message identities bind full text/time separately.
    snapshot.view = retainedSourceView({ messages: snapshot.messages.map(({ occurredAt, ...message }) => message) });
    return snapshot;
  } catch { fail('invalid_input'); }
}

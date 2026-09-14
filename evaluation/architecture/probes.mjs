import { compileDecisionBasis } from '../../core/source-basis.mjs';
import { MemoryStoreError } from '../../core/validation.mjs';

const unit = (memory, role, quote) => ({ memory, receipt: 0, role, quote });
const support = (from, to) => ({ from, to, relation: 'supports-decision' });
const challenge = (from, to) => ({ from, to, relation: 'challenges-current-basis' });
const sources = excerpts => excerpts.map((excerpt, index) => ({
  memory: { id: `synthetic-memory-${index}`, revision: 1 },
  receipts: [{ id: `synthetic-receipt-${index}`, role: 'user', excerpt }],
}));

function pair(id, excerpts, units, supportedLinks, unsupportedLinks, reason) {
  const evidence = sources(excerpts);
  return [
    { id: `${id}/supported`, sources: evidence, proposal: { units, links: supportedLinks },
      authorJudgment: 'supported', reason: 'Links follow the explicit synthetic source statements.' },
    { id: `${id}/unsupported`, sources: evidence, proposal: { units, links: unsupportedLinks },
      authorJudgment: 'unsupported', reason },
  ];
}

/** Hand-authored counterexamples, not model outputs or a held-out benchmark. */
export function boundaryProbes() {
  const actor = pair('actor', [
    'Mira chose the ferry because bicycles are allowed. I chose the bus because it runs at night.',
  ], [unit(0, 'decision', 'Mira chose the ferry'), unit(0, 'premise', 'bicycles are allowed'),
    unit(0, 'decision', 'I chose the bus'), unit(0, 'premise', 'it runs at night')],
  [support(1, 0), support(3, 2)], [support(1, 2), support(3, 0)],
  'Swapped reasons link different actors and choices despite exact source quotes.');

  const scope = pair('scope', [
    'I normally choose the library because it is quiet.',
    'Today only I chose home because the library is closed. My normal plan remains unchanged.',
  ], [unit(0, 'decision', 'I normally choose the library'), unit(0, 'premise', 'it is quiet'),
    unit(1, 'decision', 'Today only I chose home'), unit(1, 'premise', 'the library is closed')],
  [support(1, 0), support(3, 2)], [support(1, 2), support(3, 0)],
  'Swapped reasons confuse the normal plan with the explicit one-day exception.');

  const history = pair('history', [
    'On September 12 I chose Oak because September 10 firmware added duplex printing.',
    'Today an August 2 report arrived: Oak lacked duplex then. Duplex still works today.',
  ], [unit(0, 'decision', 'I chose Oak'), unit(0, 'premise', 'September 10 firmware added duplex printing'),
    unit(1, 'update', 'Oak lacked duplex then')],
  [support(1, 0)], [support(1, 0), challenge(2, 1)],
  'Late arrival of an explicitly historical report does not challenge the newer firmware state.');

  const reaffirmation = pair('reaffirmation', [
    'I chose Elm because it supports twenty kilograms.',
    'Testing confirms Elm still supports twenty kilograms.',
  ], [unit(0, 'decision', 'I chose Elm'), unit(0, 'premise', 'it supports twenty kilograms'),
    unit(1, 'update', 'Elm still supports twenty kilograms')],
  [support(1, 0)], [support(1, 0), challenge(2, 1)],
  'Explicit confirmation is not a challenge; the supported arm does not claim complete link coverage.');

  const chainSources = sources(['Ash', 'Birch', 'Cedar'].map(name =>
    `I chose ${name} because ${name} was quiet. Now ${name} is loud.`));
  const chains = count => ({
    units: ['Ash', 'Birch', 'Cedar'].slice(0, count).flatMap((name, index) => [
      unit(index, 'decision', `I chose ${name}`), unit(index, 'premise', `${name} was quiet`),
      unit(index, 'update', `Now ${name} is loud`),
    ]),
    links: Array.from({ length: count }, (_, index) => [
      support(index * 3 + 1, index * 3), challenge(index * 3 + 2, index * 3 + 1),
    ]).flat(),
  });
  return [...actor, ...scope, ...history, ...reaffirmation,
    { id: 'capacity/two-chains', sources: chainSources, proposal: chains(2),
      authorJudgment: 'supported', reason: 'Six distinct units fit the per-proposal bound.' },
    { id: 'capacity/three-chains', sources: chainSources, proposal: chains(3),
      authorJudgment: 'supported', reason: 'Nine distinct units exceed the eight-unit bound; no claim of optimal encoding.' },
    { id: 'control/fabricated-quote', sources: chainSources,
      proposal: { units: [unit(0, 'decision', 'I chose Maple')], links: [] },
      authorJudgment: 'unsupported', reason: 'The proposed quotation does not exist in the selected receipt.' },
  ];
}

export function inspectProposal(probe, compile = compileDecisionBasis) {
  try {
    const compiled = compile(probe.proposal, probe.sources);
    return { id: probe.id, authorJudgment: probe.authorJudgment, reason: probe.reason,
      compilerOutcome: 'accepted', units: compiled.units, links: compiled.links };
  } catch (error) {
    // Direct compiler calls preserve the shared shape validator's invalid_input;
    // the public review wrapper normalizes these to invalid_model_output.
    if (!(error instanceof MemoryStoreError) ||
        !['invalid_model_output', 'invalid_input'].includes(error.code)) throw error;
    return { id: probe.id, authorJudgment: probe.authorJudgment, reason: probe.reason,
      compilerOutcome: 'rejected', errorCode: error.code };
  }
}

export function runBoundaryProbes() {
  const observations = boundaryProbes().map(probe => inspectProposal(probe));
  return { kind: 'handcrafted-compiler-diagnostic', modelCalls: 0,
    semanticAccuracy: 'not-measured',
    unsupportedAccepted: observations.filter(item =>
      item.authorJudgment === 'unsupported' && item.compilerOutcome === 'accepted').length,
    observations };
}

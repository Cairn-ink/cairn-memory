import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openMemoryCore } from '../../core/contract.mjs';
import { prepareLongMemEval } from './prepare.mjs';
import { runPublicComparison } from './public-comparison.mjs';
import { scorePublicComparison, aggregateOfficialScores } from './official-scoring.mjs';

// Fixed synthetic integration only: no configuration, provider or credential path.
export async function runOfflinePublicDemo() {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-public-offline-'));
  let core;
  try {
    const source = [{
      question_id: 'synthetic-public-integration', question_type: 'knowledge-update',
      question: 'What is the current launch day?', answer: 'Friday',
      question_date: '2026/09/03 (Thu) 10:00',
      haystack_session_ids: ['answer_PRIVATE_LABEL_A', 'noans_PRIVATE_LABEL_B'],
      haystack_dates: ['2026/09/01 (Tue) 10:00', '2026/09/02 (Wed) 10:00'],
      haystack_sessions: [
        [{ role: 'user', content: 'Launch day is Thursday.\nKeep the café open. 🏕️', has_answer: false }],
        [{ role: 'user', content: 'Launch day is Friday, superseding Thursday.', has_answer: true },
          { role: 'assistant', content: 'Recorded the update.\tNo other dates were changed.' }],
      ],
      answer_session_ids: ['noans_PRIVATE_LABEL_B'],
    }];
    const input = JSON.stringify(source);
    const inputPath = path.join(root, 'synthetic.json');
    const outputDirectory = path.join(root, 'prepared');
    await writeFile(inputPath, input, { mode: 0o600 });
    await prepareLongMemEval({ inputPath, outputDirectory,
      expectedSha256: createHash('sha256').update(input).digest('hex'),
      datasetRevision: 'synthetic-only', datasetVariant: 's-cleaned',
      questionIds: [source[0].question_id] });
    const readOne = async name => JSON.parse((await readFile(path.join(outputDirectory, name), 'utf8')).trim());
    const history = await readOne('history.jsonl');
    const question = await readOne('questions.jsonl');
    const evaluator = await readOne('evaluator.jsonl');
    const observed = { extract: [], select: [], rank: [], answer: [], judge: [], stages: [] };
    const observe = (stage, value) => {
      observed.stages.push(stage);
      observed[stage].push(structuredClone(value));
    };
    const model = {
      contextWindow: 16_384, countTokens: text => Math.ceil(Buffer.byteLength(text, 'utf8') / 4),
      extract: async ({ input: payload }) => {
        observe('extract', payload);
        return { items: [{ content: 'GENERATED_SUMMARY_POISON says Sunday.', kind: 'fact',
          confidence: 0.9, sourceIndices: payload.messages.map((_, index) => index) }] };
      },
      classify: async ({ input: payload }) => {
        const existing = payload.map.find(item => item.moc?.level === 'L1');
        return { items: payload.memories.map(memory => ({ memoryId: memory.id,
          ...(existing ? { parentIds: [existing.moc.id] }
            : { parentIds: [], newL1: { title: 'Launch', parentL2Ids: [] } }),
        })) };
      },
      select: async ({ input: payload }) => {
        observe('select', payload);
        return { refs: payload.maps.flatMap(page => page.items.flatMap(item => {
          const ref = item.type === 'unfiled' ? item.ref
            : item.type === 'ref' && item.ref.childType === 'memory'
              ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
          return ref ? [{ namespaceIndex: page.namespaceIndex, ...ref }] : [];
        })) };
      },
      rank: async ({ input: payload }) => {
        observe('rank', payload);
        return { refs: payload.candidates.slice(0, payload.limit).map(item => ({
          namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision,
        })) };
      },
    };
    core = openMemoryCore({ path: path.join(root, 'memory.sqlite'), model });
    const run = await runPublicComparison({ history, question,
      namespace: { ownerId: 'synthetic-public-demo', scope: 'project', projectId: question.question_id },
      core, answerModel: 'scripted-answer-only', countTokens: model.countTokens,
      limits: { contextWindow: 32_768, outputTokens: 128, answerTimeoutMs: 1_000, recallLimit: 6 },
      answer: async ({ request }) => {
        observe('answer', request);
        const payload = JSON.parse(request.messages[1].content);
        return { text: JSON.stringify(payload.evidence).includes('Friday') ? 'Friday' : 'I do not know' };
      } });
    const score = await scorePublicComparison({ run, evaluator, judgeTimeoutMs: 1_000,
      judge: async ({ request }) => {
        observe('judge', request);
        return { text: request.messages[0].content.includes('Model Response: Friday\n\n') ? 'yes' : 'no' };
      } });
    const aggregate = aggregateOfficialScores({
      roster: [{ questionId: question.question_id, sourceQuestionId: evaluator.source_question_id,
        questionType: evaluator.question_type }], records: [score],
    });
    return { synthetic: true, interpretation: 'scripted plumbing, not measured model accuracy',
      history, question, run, score, aggregate, observed };
  } finally {
    core?.close();
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runOfflinePublicDemo();
  if (!result.run.arms.every(arm => arm.status === 'completed')) throw new Error('synthetic_comparison_failed');
  console.log(JSON.stringify({ synthetic: result.synthetic, interpretation: result.interpretation,
    arms: result.run.arms.map(({ name, status }) => ({ name, status })),
    scoring: result.score, aggregate: result.aggregate }, null, 2));
}

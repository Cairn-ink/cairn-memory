import { createHash } from 'node:crypto';

// Synthetic source-only cases. Semantic expectations live in a separate rubric.
const message = (content, role = 'user') => ({
  id: `message-${createHash('sha256').update(role + content).digest('hex').slice(0, 16)}`,
  role,
  content,
});

const cases = [
  ['alpine-seed-record-preference', [
    message('For my alpine seed archive, I prefer handwritten accession slips to a spreadsheet.'),
    message('Keep that preference scoped to the alpine seed archive; my other collections use spreadsheets.'),
  ]],
  ['seed-tray-sensor-reading', [
    message("At 09:10 on 2026-04-18, the south-window seed tray's soil sensor displayed 23°C."),
  ]],
  ['dated-voiceover-mood-zh', [
    message('2026-07-03 錄完《霧港》旁白後，我覺得安心。這只記錄當天的心情，不代表我平常的個性。'),
  ]],
  ['map-finish-considered-rejected', [
    message("For the Harbor Loop walking map, I'm considering rust-red ink. I ruled out reflective foil after the night-visibility test; I haven't chosen either finish."),
  ]],
  ['assistant-clipboard-suggestion', [
    message('For the bird-count walk, perhaps add a rain hood to the tally clipboard; that is only an idea from me.', 'assistant'),
  ]],
  ['inez-courtyard-selection', [
    message('Inez wrote me: “For my own courtyard, I chose a woven reed screen; it is not for the shared atrium.”'),
  ]],
  ['planetarium-route-decision-premise-zh', [
    message('我們為 2026 年 9 月的天文館開放日選了西側樓梯作為入場動線，因為那裡較暗，適合望遠鏡展示。'),
  ]],
  ['atlas-paper-choice-reason-revised', [
    message('The team chose pearlescent gray stock for the atlas proofs because the supplier said it dries faster than matte stock.'),
    message('The supplier corrected that: pearlescent gray dries slower than matte stock. We are keeping it for the atlas proofs; the original speed reason no longer supports the choice.'),
  ]],
  ['dated-recital-envelope-choice', [
    message('On 2026-03-08, the museum team selected indigo envelopes for invitations to the 2026-05-02 poetry reading. This choice is only for that reading; invitations for the June lecture stay cream.'),
  ]],
  ['imported-rain-gauge-event', [
    message('Imported 2026-08-19 from my field journal: on 2023-04-02, I repaired a brass rain gauge during the Bellglass Point restoration walk.'),
  ]],
  ['mountain-exhibition-caption-preference-zh', [
    message('《遠山》展的字幕版式，我已定案採用直排。這項偏好只限該展；巡迴版尚未決定。'),
  ]],
  ['foldout-stock-proposal-adopted-zh', [
    message('2026-04-10，林宜安提議把《溪徑》摺頁的塗膜紙改成甘蔗紙。'),
    message('2026-04-12，我決定採用甘蔗紙，但只適用於 2026-05-01 之後印製的版本。'),
  ]],
];

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const fixtures = freeze(cases.map(([id, messages]) => ({
  id,
  input: {
    namespace: { ownerId: 'synthetic', scope: 'project', projectId: 'qualification-meaning-probe' },
    client: 'synthetic',
    sessionId: id,
    eventId: id,
    messages,
  },
})));

export const fixtureSha256 = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');

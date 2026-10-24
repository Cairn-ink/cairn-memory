// Explicit allowlists: never hand the complete labeled calibration row to a judge.
export function correctnessBundle(row) {
  return { question: row.question, answer: structuredClone(row.candidate), G_correct: structuredClone(row.gold) };
}
export function supportBundle(row) {
  return { question: row.question, answer: structuredClone(row.candidate), delivered: structuredClone(row.delivered) };
}

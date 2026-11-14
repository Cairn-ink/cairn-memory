// Observe the same result stream as the spec reporter; never execute tests or
// change their status. A failed top-level test contributes timing too.
export default async function* fileTimingReporter(source) {
  for await (const { type, data } of source) {
    if ((type === 'test:pass' || type === 'test:fail') && data.nesting === 0) {
      yield `${JSON.stringify({
        file: data.file ?? null,
        name: data.name,
        durationMs: data.details?.duration_ms ?? 0,
        outcome: type === 'test:pass' ? 'pass' : 'fail',
      })}\n`;
    }
  }
}

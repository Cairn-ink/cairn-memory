const delayMs = Number(process.env.CAIRN_TEST_SLOW_START_MS);
const started = performance.now();
while (performance.now() - started < delayMs) {
  // Synchronous preload work counts against the process-start budget.
}

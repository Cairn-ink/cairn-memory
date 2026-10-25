import { openLifeline } from '../../process.mjs';

const lifeline = openLifeline();
lifeline.on('error', () => process.exit(2));
lifeline.resume();
// The parent keeps fd 3's writer open throughout exit. A blocking fs read on
// that descriptor would deadlock process.exit until the parent closed it.
process.stdin.once('data', () => process.exit(7));
process.stdout.write('lifeline-ready\n');

// Collect pipe bytes before decoding: a data event may split a UTF-8 sequence.
export function collectChildOutput(child, { stdoutLimit = 262144, stderrLimit = 65536, timeout = 20000 } = {}) {
  const stdout = [], stderr = [];
  let stdoutBytes = 0, stderrBytes = 0;
  child.stdout.on('data', chunk => {
    stdout.push(chunk); stdoutBytes += chunk.length;
    if (stdoutBytes > stdoutLimit) child.kill('SIGTERM');
  });
  child.stderr.on('data', chunk => {
    stderr.push(chunk); stderrBytes += chunk.length;
    if (stderrBytes > stderrLimit) child.kill('SIGTERM');
  });
  const timer = setTimeout(() => child.kill('SIGTERM'), timeout);
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        resolve({ code, signal, stdout: decoder.decode(Buffer.concat(stdout, stdoutBytes)),
          stderr: decoder.decode(Buffer.concat(stderr, stderrBytes)) });
      } catch (error) { reject(error); }
    });
  }).finally(() => clearTimeout(timer));
}

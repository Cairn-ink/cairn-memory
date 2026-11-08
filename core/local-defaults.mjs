/** Local plaintext retention; hosts may supply a sealing port instead. */
export function defaultRawOptions() {
  return Object.freeze({ mode: 'raw-v1', capBytes: 200_000_000, configureCap: false,
    port: Object.freeze({ version: 'raw-seal-v1',
      async sealRaw({ text }) { return { format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) }; },
      async openRaw({ sealed }) { return { text: new TextDecoder('utf8', { fatal: true }).decode(sealed) }; },
    }),
    readPolicy: () => ({ generation: 'local-default-v1', reason: null }),
  });
}

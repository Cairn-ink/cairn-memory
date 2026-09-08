// Frozen independently of the adapter on 2026-09-08 by directly constructing
// new Tiktoken(o200k_base).encode(text, [], []) from js-tiktoken 1.0.21.
// Primary package: https://registry.npmjs.org/js-tiktoken/1.0.21
// Tarball: https://registry.npmjs.org/js-tiktoken/-/js-tiktoken-1.0.21.tgz
// Integrity: sha512-biOj/6M5qdgx5TKjDnFT1ymSpM5tbd3ylwDtrQvFQSu0Z7bBYko2dF+W/aUkXUPuk6IVpRxk/3Q2sHOzGlS36g==
// Third-party MIT JavaScript port, https://github.com/dqbd/tiktoken.
// Token IDs make the observed counts auditable; no adapter computes expected values.
export const vectors = [
  { text: '', tokens: [] },
  { text: 'hello world', tokens: [24912, 2375] },
  { text: 'The quick brown fox jumps over the lazy dog.', tokens: [976, 4853, 19705, 68347, 65613, 1072, 290, 29082, 6446, 13] },
  { text: '你好，世界！', tokens: [177519, 979, 28428, 3393] },
  { text: '記住這個決定：使用 SQLite。', tokens: [22926, 25503, 65212, 32508, 78755, 8745, 1817, 26019, 56844, 788] },
  { text: '👩🏽‍💻🧠✨', tokens: [28823, 102, 52622, 121, 2524, 31446, 119, 4103, 100, 254, 97375] },
  { text: 'e\u0301 café', tokens: [68, 13430, 30469] },
  { text: JSON.stringify({ line: 'a\nb', quote: '"', path: 'C:\\tmp' }),
    tokens: [10848, 1137, 7534, 64, 3392, 65, 4294, 20364, 7534, 4017, 4294, 4189, 7534, 34, 47754, 11669, 18583] },
  { text: '<|endoftext|>', tokens: [27, 91, 419, 1440, 919, 91, 29] },
  { text: '<|fim_prefix|> literal <|im_start|>', tokens: [27, 91, 103473, 33197, 91, 29, 41271, 464, 91, 321, 10949, 91, 29] },
];

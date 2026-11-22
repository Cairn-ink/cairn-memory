export function hasOneLibuvWorker(value) {
  // Only an absent setting uses the default. libuv uses atoi, so an empty
  // value or one with no leading digits parses as zero and gives one worker.
  // atoi overflow differs between C libraries (4294967296 gives one worker on
  // glibc), so any value outside the int range 2..2147483647 counts as one too.
  if (value === undefined) return false;
  const digits = /^[\t\n\v\f\r ]*([+-]?[0-9]+)/.exec(value)?.[1];
  const workers = digits === undefined ? 0 : Number(digits);
  return !(workers >= 2 && workers <= 2_147_483_647);
}

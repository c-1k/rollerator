export function rollFair(min, max) {
  const range = max - min + 1;
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / range) * range;
  let n;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return min + (n % range);
}

export function createRollController() {
  let gen = 0;
  return {
    start() {
      const id = ++gen;
      return {
        id,
        isLive() {
          return id === gen;
        },
      };
    },
    cancel() {
      gen += 1;
    },
  };
}

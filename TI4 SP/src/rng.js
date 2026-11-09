// Seedable RNG (mulberry32) so games and tests are reproducible.
(function (root) {
  const TI = (root.TI = root.TI || {});

  TI.makeRng = function (seed) {
    let a = (seed >>> 0) || 1;
    function next() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    return {
      next,
      getState: () => a,
      setState: (v) => { a = v | 0; },
      d10: () => 1 + Math.floor(next() * 10),
      int: (n) => Math.floor(next() * n),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      shuffle(arr) {
        const out = arr.slice();
        for (let i = out.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [out[i], out[j]] = [out[j], out[i]];
        }
        return out;
      },
    };
  };

  if (typeof module !== 'undefined') module.exports = TI;
})(typeof window !== 'undefined' ? window : globalThis);

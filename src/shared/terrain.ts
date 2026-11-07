// Making a height grid finer by smooth interpolation (Catmull-Rom), so that slopes are not seen as flat triangles.

const mid = (a: number, b: number, c: number, d: number) => (-a + 9 * b + 9 * c - d) / 16; // Catmull-Rom halfway between b and c

/**
 * Doubles the resolution of an n x n grid: the result is (2n - 1) x (2n - 1) and keeps every original sample. Heights come out
 * as they went in (any unit). The edge uses the nearest samples twice, so it does not overshoot.
 */
export function upsample2(heights: ArrayLike<number>, n: number): Float32Array {
  const m = 2 * n - 1;
  const out = new Float32Array(m * m);
  const at = (i: number, j: number) => heights[Math.min(n - 1, Math.max(0, j)) * n + Math.min(n - 1, Math.max(0, i))];
  for (let J = 0; J < m; J++) {
    const j = J >> 1, jOdd = J & 1;
    for (let I = 0; I < m; I++) {
      const i = I >> 1, iOdd = I & 1;
      let v: number;
      if (!iOdd && !jOdd) v = at(i, j);
      else if (iOdd && !jOdd) v = mid(at(i - 1, j), at(i, j), at(i + 1, j), at(i + 2, j));
      else if (!iOdd && jOdd) v = mid(at(i, j - 1), at(i, j), at(i, j + 1), at(i, j + 2));
      else v = mid(
        mid(at(i - 1, j - 1), at(i, j - 1), at(i + 1, j - 1), at(i + 2, j - 1)),
        mid(at(i - 1, j), at(i, j), at(i + 1, j), at(i + 2, j)),
        mid(at(i - 1, j + 1), at(i, j + 1), at(i + 1, j + 1), at(i + 2, j + 1)),
        mid(at(i - 1, j + 2), at(i, j + 2), at(i + 1, j + 2), at(i + 2, j + 2)),
      );
      out[J * m + I] = v;
    }
  }
  return out;
}

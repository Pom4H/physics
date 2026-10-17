/**
 * Sampling independent one-particle detections from the absorbed probability
 * of a completed Quantum2D experiment. A run gives zero or ONE click.
 *
 * The detector profile is already an integrated first-detection probability
 * accumulated by an absorbing strip, NOT a normalized screen snapshot.
 * Non-click includes reflection, escape via boundary absorbers, and remaining
 * probability at the end of the observation window.
 */
export class DetectorSeries {
  constructor({ bins = 32, minY = -16, maxY = 16, seed = 20261017 } = {}) {
    if (!Number.isInteger(bins) || bins < 2 || !(maxY > minY)) throw new RangeError('Invalid histogram geometry');
    this.bins = bins;
    this.minY = minY;
    this.maxY = maxY;
    this.binWidth = (maxY - minY) / bins;
    this.seed = seed >>> 0;
    this.rngState = this.seed || 1;
    this.reset();
    this.profile = null;
  }

  random() {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 4294967296;
  }

  reset() {
    this.shots = 0;
    this.clicks = 0;
    this.misses = 0;
    this.counts = new Uint32Array(this.bins);
    this.hits = [];
  }

  setPrediction(profile, dx, minCellY) {
    if (!(dx > 0) || !Number.isFinite(minCellY) || !profile?.length) throw new RangeError('Invalid detector profile');
    const p = Float64Array.from(profile);
    let total = 0;
    for (const value of p) {
      if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid detector probability');
      total += value;
    }
    if (total > 1 + 1e-5) throw new RangeError('Detector probability exceeds unity');
    this.profile = p;
    this.dx = dx;
    this.minCellY = minCellY;
    this.probability = Math.min(1, total);
    this.expectedBins = new Float64Array(this.bins);
    // Integrate each grid cell's probability uniformly over its spatial width.
    // A cell overlapping two histogram bins contributes to both.
    for (let j = 0; j < p.length; j++) {
      const lo = minCellY + j * dx - dx / 2;
      const hi = lo + dx;
      for (let b = Math.max(0, Math.floor((lo - this.minY) / this.binWidth));
        b < this.bins && this.minY + b * this.binWidth < hi; b++) {
        const overlap = Math.min(hi, this.minY + (b + 1) * this.binWidth)
          - Math.max(lo, this.minY + b * this.binWidth);
        if (overlap > 0) this.expectedBins[b] += p[j] * overlap / dx;
      }
    }
    return this;
  }

  run(count = 1) {
    if (!this.profile) throw new Error('Detector prediction not ready');
    if (!Number.isInteger(count) || count < 1 || count > 10000) throw new RangeError('Invalid shot count');
    const added = [];
    for (let shot = 0; shot < count; shot++) {
      this.shots++;
      if (this.random() >= this.probability) { this.misses++; continue; }
      const value = this.random() * this.probability;
      let acc = 0, index = this.profile.length - 1;
      for (let j = 0; j < this.profile.length; j++) {
        acc += this.profile[j];
        if (value < acc) { index = j; break; }
      }
      const y = this.minCellY + index * this.dx + (this.random() - 0.5) * this.dx;
      const bin = Math.floor((y - this.minY) / this.binWidth);
      this.clicks++;
      if (bin >= 0 && bin < this.bins) this.counts[bin]++;
      this.hits.push(y);
      added.push(y);
    }
    if (this.hits.length > 2000) this.hits.splice(0, this.hits.length - 2000);
    return added;
  }

  distributions() {
    const expected = Array.from(this.expectedBins || new Float64Array(this.bins), v => v / this.binWidth);
    const measured = Array.from(this.counts, v => this.shots ? v / (this.shots * this.binWidth) : 0);
    return { expected, measured };
  }
}

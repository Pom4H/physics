/**
 * Free spin-1/2 wave packets on one periodic spatial coordinate x.
 * The spinors retain their full complex components in the sigma_z basis.
 * Defaults use hbar = c = 1; x_j = (j - n/2) length/n.
 *
 * Pauli: H = p^2/(2m) I + hbar omega sigma_z/2.
 *   The optional uniform spin term is an effective/neutral-dipole coupling,
 *   not the full minimally coupled Hamiltonian of a charged particle in B.
 * Dirac, chiral order (L up, L down, R up, R down):
 *   H = [[-c p sigma_x, mc^2 I], [mc^2 I, +c p sigma_x]].
 * Weyl: H_chi = chi c p sigma_x, chi = +1 (R) or -1 (L).
 *
 * Every model starts with the SAME discrete momentum probability distribution
 * |A(k)|^2 proportional to exp[-2 sigma^2 (k-k0)^2], restricted to k > 0.
 * The zero and Nyquist modes are excluded. Dirac and Weyl use only positive
 * energy eigenstates; the k-dependent Dirac spinor can slightly change the
 * initial position density. There is no negative-energy interference, pair
 * production, force, absorber, or three-dimensional spatial evolution here.
 *
 * Time evolution is evaluated from the initial spectrum at absolute t, then
 * transformed with an inverse FFT. There is no time-step approximation and
 * no normalization during propagation. Spatial periodicity remains physical
 * to this finite numerical model; stats report the probability near its edges.
 */

const TAU = 2 * Math.PI;
const INV_SQRT_2 = 1 / Math.sqrt(2);
const PLANS = new Map();

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive and finite`);
  return value;
}

function finite(value, name) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function sign(value, name) {
  if (value !== 1 && value !== -1) throw new RangeError(`${name} must be +1 or -1`);
  return value;
}

function planFor(n) {
  if (!Number.isInteger(n) || n < 16 || n > 1048576 || (n & (n - 1)) !== 0) {
    throw new RangeError('n must be a power of two between 16 and 1048576');
  }
  if (PLANS.has(n)) return PLANS.get(n);
  const reverse = new Uint32Array(n);
  const cosine = new Float64Array(n / 2);
  const sine = new Float64Array(n / 2);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let a = i, b = 0;
    for (let bit = 0; bit < bits; bit++) { b = (b << 1) | (a & 1); a >>= 1; }
    reverse[i] = b;
  }
  for (let i = 0; i < n / 2; i++) {
    cosine[i] = Math.cos(TAU * i / n);
    sine[i] = Math.sin(TAU * i / n);
  }
  const plan = { n, reverse, cosine, sine };
  PLANS.set(n, plan);
  return plan;
}

/** In-place inverse FFT, including its 1/n normalization. */
function inverseFFT(re, im, plan) {
  const { n, reverse, cosine, sine } = plan;
  for (let i = 0; i < n; i++) {
    const j = reverse[i];
    if (j > i) {
      let value = re[i]; re[i] = re[j]; re[j] = value;
      value = im[i]; im[i] = im[j]; im[j] = value;
    }
  }
  for (let width = 2; width <= n; width *= 2) {
    const half = width / 2, stride = n / width;
    for (let start = 0; start < n; start += width) {
      for (let j = 0; j < half; j++) {
        const a = start + j, b = a + half;
        const cos = cosine[j * stride], sin = sine[j * stride];
        const real = cos * re[b] - sin * im[b];
        const imaginary = cos * im[b] + sin * re[b];
        re[b] = re[a] - real; im[b] = im[a] - imaginary;
        re[a] += real; im[a] += imaginary;
      }
    }
  }
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function component(label, n) {
  return { label, re: new Float64Array(n), im: new Float64Array(n) };
}

/**
 * model: 'pauli' | 'dirac' | 'weyl'.
 * sigma is the position-density standard deviation of the corresponding
 * untruncated continuum scalar Gaussian, not an imposed Dirac density width.
 * helicity selects the sigma_x eigenstate for Dirac and the default Pauli
 * state. Weyl uses helicity = chirality because p > 0 and E > 0.
 * Explicit Pauli theta, phi specify (cos(theta/2), e^{i phi} sin(theta/2)).
 *
 * initialSpectrum contains normalized t=0 coefficients C_a(k), with
 * sum_{a,k}|C_a(k)|^2 = 1 and psi_a(x,t) = sum_k C_a(k,t)e^{ikx}/sqrt(length).
 * Public typed arrays are reused. Treat initialSpectrum and the momentum
 * arrays as read-only; setTime refreshes position components and observables.
 */
export class Spinor1D {
  constructor({ model = 'dirac', n = 512, length = 96, ...params } = {}) {
    this._plan = planFor(n);
    this.n = n;
    this.length = positive(length, 'length');
    this.dx = length / n;
    this.kgrid = new Float64Array(n);
    this.pgrid = new Float64Array(n);
    this.spectralProbability = new Float64Array(n);
    this.spectralEnergy = new Float64Array(n);
    this.density = new Float64Array(n);
    this.spinX = new Float64Array(n);
    this.spinY = new Float64Array(n);
    this.spinZ = new Float64Array(n);
    this.currentDensity = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.kgrid[i] = TAU * (i < n / 2 ? i : i - n) / length;
    }
    this.reset({ model, ...params });
  }

  reset(changes = {}) {
    if (changes.n !== undefined && changes.n !== this.n) throw new RangeError('Create a new Spinor1D to change n');
    if (changes.length !== undefined && changes.length !== this.length) throw new RangeError('Create a new Spinor1D to change length');
    const model = changes.model ?? this.model ?? 'dirac';
    if (!['pauli', 'dirac', 'weyl'].includes(model)) throw new RangeError(`Unknown spinor model ${model}`);
    const previous = model === this.model ? this.params : {};
    const p = {
      x0: -Math.min(12, this.length / 8), sigma: 2.4, k0: 1.6,
      mass: 1, c: 1, hbar: 1, helicity: 1, chirality: 1,
      theta: Math.PI / 2, phi: 0, omega: 0,
      ...previous, ...changes, model,
    };
    // Changing helicity without explicit Bloch angles prepares eta_helicity.
    if ((changes.helicity !== undefined || !this.params || model !== this.model)
        && changes.theta === undefined && changes.phi === undefined) {
      p.theta = Math.PI / 2;
      p.phi = p.helicity === 1 ? 0 : Math.PI;
    }
    positive(p.sigma, 'sigma'); positive(p.k0, 'k0');
    positive(p.c, 'c'); positive(p.hbar, 'hbar');
    finite(p.mass, 'mass'); finite(p.x0, 'x0');
    finite(p.theta, 'theta'); finite(p.phi, 'phi'); finite(p.omega, 'omega');
    sign(p.helicity, 'helicity'); sign(p.chirality, 'chirality');
    if (p.mass < 0 || (model === 'pauli' && p.mass === 0)) {
      throw new RangeError(model === 'pauli' ? 'Pauli mass must be positive' : 'mass must be nonnegative');
    }
    if (p.theta < 0 || p.theta > Math.PI) throw new RangeError('theta must lie in [0, pi]');
    if (Math.abs(p.x0) >= this.length / 2) throw new RangeError('x0 must lie inside the periodic spatial window');
    if (p.k0 >= Math.PI / this.dx) throw new RangeError('k0 must be below the grid Nyquist wave number');
    if (model === 'weyl') p.mass = 0;

    this.model = model;
    this.params = p;
    this.chirality = model === 'weyl' ? p.chirality : null;
    const labels = model === 'dirac' ? ['L↑', 'L↓', 'R↑', 'R↓']
      : model === 'weyl' ? [`χ${p.chirality === 1 ? 'R' : 'L'}↑`, `χ${p.chirality === 1 ? 'R' : 'L'}↓`]
        : ['ψ↑', 'ψ↓'];
    this.components = labels.map((label) => component(label, this.n));
    this.initialSpectrum = labels.map((label) => component(label, this.n));
    this.componentDensity = labels.map(() => new Float64Array(this.n));
    this._derivatives = model === 'pauli' ? labels.map((label) => component(label, this.n)) : null;
    this._componentNorms = new Float64Array(labels.length);
    this._observables = { componentWeights: new Array(labels.length).fill(0) };
    this.spectralProbability.fill(0);

    // Subtract the largest logarithmic weight before exponentiation, so a
    // narrow but resolved momentum state does not underflow as a whole.
    let largestLogWeight = -Infinity;
    for (let i = 1; i < this.n / 2; i++) {
      const logWeight = -2 * (p.sigma * (this.kgrid[i] - p.k0)) ** 2;
      this.spectralProbability[i] = logWeight;
      largestLogWeight = Math.max(largestLogWeight, logWeight);
    }
    let weightSum = 0;
    for (let i = 1; i < this.n / 2; i++) {
      const weight = Math.exp(this.spectralProbability[i] - largestLogWeight);
      this.spectralProbability[i] = weight;
      weightSum += weight;
    }
    if (!(weightSum > 0 && Number.isFinite(weightSum))) throw new RangeError('The momentum Gaussian cannot be resolved with these parameters');
    for (let i = 1; i < this.n / 2; i++) this.spectralProbability[i] /= weightSum;

    const zetaUp = Math.cos(p.theta / 2);
    const zetaDownRe = Math.sin(p.theta / 2) * Math.cos(p.phi);
    const zetaDownIm = Math.sin(p.theta / 2) * Math.sin(p.phi);
    let meanMomentum = 0, meanSquaredMomentum = 0, meanEnergy = 0, meanGroupVelocity = 0;
    for (let i = 0; i < this.n; i++) {
      const momentum = p.hbar * this.kgrid[i];
      this.pgrid[i] = momentum;
      const energy = model === 'pauli' ? momentum ** 2 / (2 * p.mass)
        : model === 'dirac' ? Math.hypot(p.c * momentum, p.mass * p.c ** 2)
          : p.c * Math.abs(momentum);
      this.spectralEnergy[i] = energy;
      const probability = this.spectralProbability[i];
      if (probability === 0) continue;
      const magnitude = Math.sqrt(probability);
      const angle = -this.kgrid[i] * p.x0;
      const ar = magnitude * Math.cos(angle), ai = magnitude * Math.sin(angle);
      if (model === 'pauli') {
        this.initialSpectrum[0].re[i] = ar * zetaUp;
        this.initialSpectrum[0].im[i] = ai * zetaUp;
        this.initialSpectrum[1].re[i] = ar * zetaDownRe - ai * zetaDownIm;
        this.initialSpectrum[1].im[i] = ar * zetaDownIm + ai * zetaDownRe;
      } else if (model === 'weyl') {
        this.initialSpectrum[0].re[i] = ar * INV_SQRT_2;
        this.initialSpectrum[0].im[i] = ai * INV_SQRT_2;
        this.initialSpectrum[1].re[i] = ar * INV_SQRT_2 * p.chirality;
        this.initialSpectrum[1].im[i] = ai * INV_SQRT_2 * p.chirality;
      } else {
        // Stable even arbitrarily close to m=0: do not subtract E-cp.
        const large = Math.sqrt((1 + p.c * momentum / energy) / 2);
        const small = p.mass * p.c ** 2 / (2 * energy * large);
        const left = (p.helicity === 1 ? small : large) * INV_SQRT_2;
        const right = (p.helicity === 1 ? large : small) * INV_SQRT_2;
        const factors = [left, left * p.helicity, right, right * p.helicity];
        for (let a = 0; a < 4; a++) {
          this.initialSpectrum[a].re[i] = ar * factors[a];
          this.initialSpectrum[a].im[i] = ai * factors[a];
        }
      }
      meanMomentum += probability * momentum;
      meanSquaredMomentum += probability * momentum ** 2;
      meanEnergy += probability * energy;
      meanGroupVelocity += probability * (model === 'pauli' ? momentum / p.mass
        : model === 'dirac' ? p.c ** 2 * momentum / energy : p.c);
    }
    if (model === 'pauli') meanEnergy += p.hbar * p.omega * Math.cos(p.theta) / 2;
    this._spectralStats = {
      meanMomentum, meanSquaredMomentum, rmsMomentum: Math.sqrt(meanSquaredMomentum),
      momentumVariance: Math.max(0, meanSquaredMomentum - meanMomentum ** 2),
      meanEnergy, meanGroupVelocity,
      meanKineticEnergy: model === 'pauli' ? meanSquaredMomentum / (2 * p.mass)
        : model === 'dirac' ? meanEnergy - p.mass * p.c ** 2 : meanEnergy,
      nonrelativisticRatio: p.mass > 0 ? Math.sqrt(meanSquaredMomentum) / (p.mass * p.c) : null,
      positiveEnergyFraction: model === 'pauli' ? null : 1,
    };
    return this.setTime(0);
  }

  setTime(time) {
    if (!Number.isFinite(time) || time < 0) throw new RangeError('time must be finite and nonnegative');
    const { hbar, omega } = this.params;
    const transformScale = this.n / Math.sqrt(this.length);
    for (let a = 0; a < this.components.length; a++) {
      const source = this.initialSpectrum[a];
      const target = this.components[a];
      const derivative = this._derivatives?.[a];
      const spinPhase = this.model === 'pauli' ? (a === 0 ? -1 : 1) * omega * time / 2 : 0;
      for (let i = 0; i < this.n; i++) {
        const angle = -this.spectralEnergy[i] * time / hbar + spinPhase;
        const cos = Math.cos(angle), sin = Math.sin(angle);
        // (-1)^i accounts for coordinates centered at -length/2.
        const scale = i % 2 === 0 ? transformScale : -transformScale;
        const re = (source.re[i] * cos - source.im[i] * sin) * scale;
        const im = (source.re[i] * sin + source.im[i] * cos) * scale;
        target.re[i] = re; target.im[i] = im;
        if (derivative) {
          derivative.re[i] = -this.kgrid[i] * im;
          derivative.im[i] = this.kgrid[i] * re;
        }
      }
      inverseFFT(target.re, target.im, this._plan);
      if (derivative) inverseFFT(derivative.re, derivative.im, this._plan);
    }
    this.time = time;
    this._updateObservables();
    return this;
  }

  step(dt, steps = 1) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and nonnegative');
    if (!Number.isInteger(steps) || steps < 0) throw new RangeError('steps must be a nonnegative integer');
    return this.setTime(this.time + dt * steps);
  }

  _updateObservables() {
    const { c, hbar, mass } = this.params;
    const count = this.components.length;
    const componentNorms = this._componentNorms;
    componentNorms.fill(0);
    let norm = 0, mean = 0, squaredMean = 0, sxTotal = 0, syTotal = 0, szTotal = 0;
    let currentTotal = 0, edge = 0, peakDensity = 0;
    for (let i = 0; i < this.n; i++) {
      let density = 0;
      for (let a = 0; a < count; a++) {
        const state = this.components[a];
        const da = state.re[i] ** 2 + state.im[i] ** 2;
        this.componentDensity[a][i] = da;
        componentNorms[a] += da * this.dx;
        density += da;
      }
      let sx = 0, sy = 0, sz = 0, relativisticCurrent = 0;
      for (let a = 0; a < count; a += 2) {
        const up = this.components[a], down = this.components[a + 1];
        const pairX = 2 * (up.re[i] * down.re[i] + up.im[i] * down.im[i]);
        sx += pairX;
        sy += 2 * (up.re[i] * down.im[i] - up.im[i] * down.re[i]);
        sz += this.componentDensity[a][i] - this.componentDensity[a + 1][i];
        if (this.model === 'dirac') relativisticCurrent += (a === 0 ? -c : c) * pairX;
        else if (this.model === 'weyl') relativisticCurrent = c * this.params.chirality * pairX;
      }
      let current = relativisticCurrent;
      if (this.model === 'pauli') {
        current = 0;
        for (let a = 0; a < count; a++) {
          const state = this.components[a], derivative = this._derivatives[a];
          current += hbar / mass * (state.re[i] * derivative.im[i] - state.im[i] * derivative.re[i]);
        }
      }
      this.density[i] = density;
      this.currentDensity[i] = current;
      // Spin direction is undefined at a node; suppress roundoff-only tails.
      const inverseDensity = density > 1e-18 / this.length ? 1 / density : 0;
      this.spinX[i] = sx * inverseDensity;
      this.spinY[i] = sy * inverseDensity;
      this.spinZ[i] = sz * inverseDensity;
      const x = (i - this.n / 2) * this.dx;
      const probability = density * this.dx;
      norm += probability;
      mean += x * probability;
      squaredMean += x * x * probability;
      sxTotal += sx * this.dx; syTotal += sy * this.dx; szTotal += sz * this.dx;
      currentTotal += current * this.dx;
      if (Math.abs(x) >= this.length * 0.4) edge += probability;
      peakDensity = Math.max(peakDensity, density);
    }
    const inverseNorm = 1 / norm;
    const xMean = mean * inverseNorm;
    const leftWeight = this.model === 'dirac' ? (componentNorms[0] + componentNorms[1]) * inverseNorm
      : this.model === 'weyl' ? (this.params.chirality === -1 ? 1 : 0) : null;
    const rightWeight = this.model === 'dirac' ? (componentNorms[2] + componentNorms[3]) * inverseNorm
      : this.model === 'weyl' ? (this.params.chirality === 1 ? 1 : 0) : null;
    const result = this._observables;
    result.time = this.time;
    result.norm = norm;
    result.xMean = xMean;
    result.sigmaX = Math.sqrt(Math.max(0, squaredMean * inverseNorm - xMean ** 2));
    result.spinX = sxTotal * inverseNorm;
    result.spinY = syTotal * inverseNorm;
    result.spinZ = szTotal * inverseNorm;
    result.leftWeight = leftWeight;
    result.rightWeight = rightWeight;
    result.meanChirality = leftWeight === null ? null : rightWeight - leftWeight;
    result.meanVelocity = currentTotal * inverseNorm;
    result.periodicEdgeProbability = edge;
    result.peakDensity = peakDensity;
    for (let a = 0; a < count; a++) result.componentWeights[a] = componentNorms[a] * inverseNorm;
  }

  stats() {
    return { ...this._spectralStats, ...this._observables, componentWeights: [...this._observables.componentWeights] };
  }
}

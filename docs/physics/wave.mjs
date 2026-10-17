/**
 * Численное решение i∂ψ/∂t = (−½∇² + V − iW)ψ при ℏ = m = 1.
 * W ≥ 0 — явно учитываемый поглотитель у границы вычислительного окна.
 * Без W дискретное расщепление Стрэнга унитарно: нормировка на шаге не нужна.
 * FFT задаёт периодические границы; поглотитель уменьшает возврат волны,
 * но не превращает конечную сетку в точную бесконечную область.
 */

const TAU = 2 * Math.PI;
const FFT_PLANS = new Map();

function positive(value, name) {
  if (!(Number.isFinite(value) && value > 0)) throw new RangeError(`${name} must be positive and finite`);
  return value;
}

function makePlan(n) {
  if (!(Number.isInteger(n) && n >= 16 && (n & (n - 1)) === 0)) {
    throw new RangeError('n must be a power of two, at least 16');
  }
  if (FFT_PLANS.has(n)) return FFT_PLANS.get(n);
  const reverse = new Uint32Array(n);
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  let bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let a = i, b = 0;
    for (let j = 0; j < bits; j++) { b = (b << 1) | (a & 1); a >>= 1; }
    reverse[i] = b;
  }
  for (let j = 0; j < n / 2; j++) {
    cos[j] = Math.cos(TAU * j / n);
    sin[j] = Math.sin(TAU * j / n);
  }
  const plan = { n, reverse, cos, sin };
  FFT_PLANS.set(n, plan);
  return plan;
}

/** FFT на строке или столбце; обратное преобразование содержит 1/n. */
function fft(re, im, plan, inverse = false, offset = 0, stride = 1) {
  const { n, reverse, cos, sin } = plan;
  for (let i = 0; i < n; i++) {
    const j = reverse[i];
    if (j > i) {
      const a = offset + i * stride, b = offset + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t;
      t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2, twiddleStep = n / size;
    for (let start = 0; start < n; start += size) {
      for (let j = 0; j < half; j++) {
        const a = offset + (start + j) * stride;
        const b = a + half * stride;
        const wr = cos[j * twiddleStep];
        const wi = (inverse ? 1 : -1) * sin[j * twiddleStep];
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      const p = offset + i * stride;
      re[p] /= n; im[p] /= n;
    }
  }
}

function squaredWaveNumbers(n, length) {
  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = TAU * (i <= n / 2 ? i : i - n) / length;
    result[i] = k * k;
  }
  return result;
}

function normalizeInitial(re, im, cellMeasure) {
  let norm = 0;
  for (let i = 0; i < re.length; i++) norm += re[i] ** 2 + im[i] ** 2;
  const scale = 1 / Math.sqrt(norm * cellMeasure);
  for (let i = 0; i < re.length; i++) { re[i] *= scale; im[i] *= scale; }
}

function absorptionProfile(x, length, width, strength) {
  const u = Math.max(0, (Math.abs(x) - (length / 2 - width)) / width);
  return strength * u ** 4;
}

function rotate(re, im, cos, sin) {
  for (let i = 0; i < re.length; i++) {
    const a = re[i], b = im[i];
    re[i] = a * cos[i] - b * sin[i];
    im[i] = a * sin[i] + b * cos[i];
  }
}

function validateStep(dt, steps) {
  if (!(Number.isFinite(dt) && dt >= 0)) throw new RangeError('dt must be finite and nonnegative');
  if (!(Number.isInteger(steps) && steps >= 0)) throw new RangeError('steps must be a nonnegative integer');
}

/**
 * Одномерные пакеты: free, barrier, oscillator; точный спектр ямы: well.
 * sigma — стандартное отклонение плотности |ψ|², k0 — волновое число.
 * x_j = (j − n/2) dx. re, im и potential — Float64Array.
 * reset сохраняет параметры текущей сцены; при смене mode берёт новые defaults.
 */
export class Quantum1D {
  constructor({ mode = 'free', n = 512, length = 64, ...params } = {}) {
    this._plan = makePlan(n);
    this.n = n;
    this.length = positive(length, 'length');
    this.dx = length / n;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.potential = new Float64Array(n);
    this.absorber = new Float64Array(n);
    this._k2 = squaredWaveNumbers(n, length);
    this._vCos = new Float64Array(n);
    this._vSin = new Float64Array(n);
    this._vAmp = new Float64Array(n);
    this._kCos = new Float64Array(n);
    this._kSin = new Float64Array(n);
    this.reset({ mode, ...params });
  }

  reset(changes = {}) {
    const mode = changes.mode ?? this.mode ?? 'free';
    if (!['free', 'barrier', 'oscillator', 'well'].includes(mode)) throw new RangeError(`Unknown mode ${mode}`);
    const defaults = {
      mode, x0: -Math.min(12, this.length * 0.22), sigma: 1.6, k0: 3,
      barrierCenter: 0, barrierHeight: 5, barrierWidth: 1.2,
      omega: 0.32, absorber: true,
      absorberWidth: Math.min(8, this.length * 0.125), absorberStrength: 12,
      maxStep: 0.025, wellWidth: 12, wellCenter: 0, n1: 1, n2: 2,
      wellMix: 0.5, wellPhase: 0,
    };
    if (mode === 'oscillator') {
      defaults.x0 = -Math.min(8, this.length * 0.18);
      defaults.k0 = 0;
      defaults.sigma = Math.sqrt(1 / (2 * (changes.omega ?? this.params?.omega ?? defaults.omega)));
    }
    if (mode === 'barrier') {
      defaults.sigma = 2;
      defaults.barrierHeight = 8;
      defaults.barrierWidth = 0.75;
      defaults.maxStep = 0.01;
    }
    const old = mode === this.mode ? this.params : {};
    const p = { ...defaults, ...old, ...changes, mode };
    if (mode === 'oscillator' && changes.omega !== undefined && changes.sigma === undefined) {
      p.sigma = Math.sqrt(1 / (2 * p.omega));
    }
    positive(p.sigma, 'sigma'); positive(p.barrierWidth, 'barrierWidth');
    positive(p.omega, 'omega'); positive(p.maxStep, 'maxStep');
    positive(p.absorberWidth, 'absorberWidth');
    if (!(p.absorberStrength >= 0 && Number.isFinite(p.absorberStrength))) throw new RangeError('Invalid absorberStrength');
    if (!(p.barrierHeight >= 0 && Number.isFinite(p.barrierHeight))) throw new RangeError('Invalid barrierHeight');
    if (!Number.isFinite(p.x0) || !Number.isFinite(p.k0)) throw new RangeError('Invalid packet position or momentum');
    this.mode = mode;
    this.params = p;
    this.time = 0;
    this.absorbed = 0;
    this.absorbedLeft = 0;
    this.absorbedRight = 0;
    this.initialKineticEnergy = null;
    this.aboveBarrierFraction = null;
    this._cachedDt = NaN;
    this.maxStep = p.maxStep;
    this.re.fill(0); this.im.fill(0); this.potential.fill(0); this.absorber.fill(0);

    if (mode === 'well') {
      positive(p.wellWidth, 'wellWidth');
      if (!(p.wellWidth < this.length)) throw new RangeError('wellWidth must be less than length');
      if (!Number.isFinite(p.wellCenter) || Math.abs(p.wellCenter) + p.wellWidth / 2 >= this.length / 2) {
        throw new RangeError('The complete well must lie inside the simulation window');
      }
      if (!(Number.isInteger(p.n1) && p.n1 > 0 && Number.isInteger(p.n2) && p.n2 > 0 && p.n1 !== p.n2)) {
        throw new RangeError('n1 and n2 must be distinct positive integers');
      }
      if (!(p.wellMix >= 0 && p.wellMix <= 1)) throw new RangeError('wellMix must be in [0, 1]');
      this.wellBounds = [p.wellCenter - p.wellWidth / 2, p.wellCenter + p.wellWidth / 2];
      this._wellA = new Float64Array(this.n);
      this._wellB = new Float64Array(this.n);
      for (let i = 0; i < this.n; i++) {
        const x = (i - this.n / 2) * this.dx;
        if (x <= this.wellBounds[0] || x >= this.wellBounds[1]) {
          this.potential[i] = Infinity;
        } else {
          const u = (x - this.wellBounds[0]) / p.wellWidth;
          this._wellA[i] = Math.sqrt(2 / p.wellWidth) * Math.sin(p.n1 * Math.PI * u);
          this._wellB[i] = Math.sqrt(2 / p.wellWidth) * Math.sin(p.n2 * Math.PI * u);
        }
      }
      this._wellEnergyA = (p.n1 * Math.PI / p.wellWidth) ** 2 / 2;
      this._wellEnergyB = (p.n2 * Math.PI / p.wellWidth) ** 2 / 2;
      this.initialKineticEnergy = (1 - p.wellMix) * this._wellEnergyA + p.wellMix * this._wellEnergyB;
      this._wellScale = 1;
      this._evaluateWell();
      // Только начальная дискретная нормировка, общий множитель фиксирован во времени.
      this._wellScale = 1 / Math.sqrt(this.stats().norm);
      this._evaluateWell();
      return this;
    }

    this.wellBounds = null;
    for (let i = 0; i < this.n; i++) {
      const x = (i - this.n / 2) * this.dx;
      const a = Math.exp(-((x - p.x0) ** 2) / (4 * p.sigma ** 2));
      const phase = p.k0 * (x - p.x0);
      this.re[i] = a * Math.cos(phase);
      this.im[i] = a * Math.sin(phase);
      if (mode === 'barrier') {
        // Усреднение прямоугольной стенки по ячейке сохраняет её заданную ширину.
        const overlap = Math.max(0, Math.min(x + this.dx / 2, p.barrierCenter + p.barrierWidth / 2)
          - Math.max(x - this.dx / 2, p.barrierCenter - p.barrierWidth / 2));
        this.potential[i] = p.barrierHeight * Math.min(1, overlap / this.dx);
      }
      if (mode === 'oscillator') this.potential[i] = 0.5 * p.omega ** 2 * x ** 2;
      if (p.absorber) this.absorber[i] = absorptionProfile(x, this.length, p.absorberWidth, p.absorberStrength);
    }
    normalizeInitial(this.re, this.im, this.dx);
    // Доля исходного спектра с E_kin > V₀; не выдаём весь прошедший пакет за туннелирование.
    const spectralRe = this.re.slice(), spectralIm = this.im.slice();
    fft(spectralRe, spectralIm, this._plan);
    let spectralNorm = 0, above = 0, energy = 0;
    for (let i = 0; i < this.n; i++) {
      const q = spectralRe[i] ** 2 + spectralIm[i] ** 2;
      spectralNorm += q; energy += q * this._k2[i] / 2;
      if (this._k2[i] / 2 > p.barrierHeight) above += q;
    }
    this.initialKineticEnergy = energy / spectralNorm;
    this.aboveBarrierFraction = mode === 'barrier' ? above / spectralNorm : null;
    return this;
  }

  _evaluateWell() {
    const p = this.params;
    const a = this._wellScale * Math.sqrt(1 - p.wellMix);
    const b = this._wellScale * Math.sqrt(p.wellMix);
    const phaseA = -this._wellEnergyA * this.time;
    const phaseB = p.wellPhase - this._wellEnergyB * this.time;
    const ar = a * Math.cos(phaseA), ai = a * Math.sin(phaseA);
    const br = b * Math.cos(phaseB), bi = b * Math.sin(phaseB);
    for (let i = 0; i < this.n; i++) {
      this.re[i] = ar * this._wellA[i] + br * this._wellB[i];
      this.im[i] = ai * this._wellA[i] + bi * this._wellB[i];
    }
  }

  _cache(dt) {
    if (dt === this._cachedDt) return;
    this._cachedDt = dt;
    for (let i = 0; i < this.n; i++) {
      const v = -this.potential[i] * dt / 2;
      const k = -this._k2[i] * dt / 2;
      this._vCos[i] = Math.cos(v); this._vSin[i] = Math.sin(v);
      this._vAmp[i] = Math.exp(-this.absorber[i] * dt / 2);
      this._kCos[i] = Math.cos(k); this._kSin[i] = Math.sin(k);
    }
  }

  _potentialHalfStep() {
    let left = 0, right = 0;
    const center = this.params.barrierCenter;
    for (let i = 0; i < this.n; i++) {
      const a = this.re[i], b = this.im[i], amp = this._vAmp[i];
      const loss = (a * a + b * b) * (1 - amp * amp);
      if ((i - this.n / 2) * this.dx < center) left += loss; else right += loss;
      this.re[i] = (a * this._vCos[i] - b * this._vSin[i]) * amp;
      this.im[i] = (a * this._vSin[i] + b * this._vCos[i]) * amp;
    }
    this.absorbedLeft += left * this.dx;
    this.absorbedRight += right * this.dx;
    this.absorbed += (left + right) * this.dx;
  }

  step(dt, steps = 1) {
    validateStep(dt, steps);
    if (dt === 0 || steps === 0) return this;
    if (this.mode === 'well') {
      this.time += dt * steps;
      this._evaluateWell();
      return this;
    }
    const subdivisions = Math.max(1, Math.ceil(dt / this.maxStep));
    const h = dt / subdivisions;
    this._cache(h);
    for (let s = 0; s < steps * subdivisions; s++) {
      this._potentialHalfStep();
      fft(this.re, this.im, this._plan);
      rotate(this.re, this.im, this._kCos, this._kSin);
      fft(this.re, this.im, this._plan, true);
      this._potentialHalfStep();
    }
    this.time += dt * steps;
    return this;
  }

  /** Вероятности left/right/barrier — пространственные области, не направление движения. */
  stats() {
    let norm = 0, first = 0, second = 0, left = 0, right = 0, barrier = 0;
    const lo = this.params.barrierCenter - this.params.barrierWidth / 2;
    const hi = this.params.barrierCenter + this.params.barrierWidth / 2;
    for (let i = 0; i < this.n; i++) {
      const x = (i - this.n / 2) * this.dx;
      const q = (this.re[i] ** 2 + this.im[i] ** 2) * this.dx;
      norm += q; first += x * q; second += x * x * q;
      if (x < lo) left += q; else if (x > hi) right += q; else barrier += q;
    }
    const xMean = norm > 1e-15 ? first / norm : 0;
    const sigmaX = norm > 1e-15 ? Math.sqrt(Math.max(0, second / norm - xMean ** 2)) : 0;
    return {
      norm, survival: norm, xMean, sigmaX, left, right, barrier,
      absorbed: this.absorbed, absorbedLeft: this.absorbedLeft, absorbedRight: this.absorbedRight,
      transmitted: right + this.absorbedRight,
      leftTotal: left + this.absorbedLeft, rightTotal: right + this.absorbedRight,
      accounted: norm + this.absorbed,
      initialKineticEnergy: this.initialKineticEnergy ?? null,
      aboveBarrierFraction: this.aboveBarrierFraction ?? null,
    };
  }
}

/** Плавная прямоугольная область; физическая ширина edgeSoftness не зависит от n. */
function smoothRectangle(x, center, width, softness) {
  if (softness === 0) return Math.abs(x - center) < width / 2 ? 1 : 0;
  return 0.5 * (Math.tanh((x - center + width / 2) / softness) - Math.tanh((x - center - width / 2) / softness));
}

/**
 * Две щели: настоящее двумерное TDSE, не сумма нарисованных окружностей.
 * Хранение y-major: index = yIndex * n + xIndex. Оси x,y = (index−n/2)dx.
 * Потенциал конечный: barrierHeight × маска стенки × (1−маска щелей).
 */
export class Quantum2D {
  constructor({ n = 128, length = 32, ...params } = {}) {
    this._plan = makePlan(n);
    this.n = n;
    this.length = positive(length, 'length');
    this.dx = length / n;
    const count = n * n;
    this.re = new Float64Array(count);
    this.im = new Float64Array(count);
    this.potential = new Float64Array(count);
    this.absorber = new Float64Array(count);
    this.detector = new Float64Array(count);
    this.detectedProfile = new Float64Array(n);
    this._vCos = new Float64Array(count);
    this._vSin = new Float64Array(count);
    this._vAmp = new Float64Array(count);
    this._kCos = new Float64Array(count);
    this._kSin = new Float64Array(count);
    const k2 = squaredWaveNumbers(n, length);
    this._k2 = new Float64Array(count);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) this._k2[y * n + x] = k2[x] + k2[y];
    this.reset(params);
  }

  reset(changes = {}) {
    const p = {
      packetX: -8.5, packetY: 0, sigmaX: 1.2, sigmaY: 3.6, k0: 2.5, ky: 0,
      barrierX: 0, barrierHeight: 12, barrierWidth: 1.5,
      slitSeparation: 5, slitWidth: 1.8, edgeSoftness: 0.18,
      absorber: true, absorberWidth: Math.min(4, this.length / 8), absorberStrength: 12,
      maxStep: 0.008,
      detect: false, detectorX: 6, detectorWidth: 0.8, detectorStrength: 8,
      ...this.params, ...changes,
    };
    for (const key of ['sigmaX', 'sigmaY', 'barrierWidth', 'slitSeparation', 'slitWidth', 'absorberWidth', 'maxStep', 'detectorWidth']) positive(p[key], key);
    for (const key of ['barrierHeight', 'edgeSoftness', 'absorberStrength', 'detectorStrength']) {
      if (!(Number.isFinite(p[key]) && p[key] >= 0)) throw new RangeError(`${key} must be nonnegative and finite`);
    }
    for (const key of ['packetX', 'packetY', 'k0', 'ky', 'barrierX', 'detectorX']) {
      if (!Number.isFinite(p[key])) throw new RangeError(`${key} must be finite`);
    }
    this.params = p;
    this.time = 0;
    this.absorbed = 0;
    this.absorbedLeft = 0;
    this.absorbedRight = 0;
    this.detected = 0;
    this.detectedProfile.fill(0);
    this.maxStep = p.maxStep;
    this._cachedDt = NaN;
    const n = this.n, dx = this.dx;
    for (let j = 0; j < n; j++) {
      const y = (j - n / 2) * dx;
      const lower = smoothRectangle(y, -p.slitSeparation / 2, p.slitWidth, p.edgeSoftness);
      const upper = smoothRectangle(y, p.slitSeparation / 2, p.slitWidth, p.edgeSoftness);
      const closed = 1 - Math.min(1, lower + upper);
      const wy = p.absorber ? absorptionProfile(y, this.length, p.absorberWidth, p.absorberStrength) : 0;
      for (let i = 0; i < n; i++) {
        const x = (i - n / 2) * dx, index = j * n + i;
        const amplitude = Math.exp(-((x - p.packetX) ** 2) / (4 * p.sigmaX ** 2) - ((y - p.packetY) ** 2) / (4 * p.sigmaY ** 2));
        const phase = p.k0 * (x - p.packetX) + p.ky * (y - p.packetY);
        this.re[index] = amplitude * Math.cos(phase);
        this.im[index] = amplitude * Math.sin(phase);
        this.potential[index] = p.barrierHeight * smoothRectangle(x, p.barrierX, p.barrierWidth, p.edgeSoftness) * closed;
        this.absorber[index] = wy + (p.absorber ? absorptionProfile(x, this.length, p.absorberWidth, p.absorberStrength) : 0);
        // Complex absorbing strip = irreversible, spatially resolved detector.
        this.detector[index] = p.detect
          ? p.detectorStrength * smoothRectangle(x, p.detectorX, p.detectorWidth, 0.08)
          : 0;
      }
    }
    normalizeInitial(this.re, this.im, dx * dx);
    return this;
  }

  _fft(inverse) {
    for (let y = 0; y < this.n; y++) fft(this.re, this.im, this._plan, inverse, y * this.n, 1);
    for (let x = 0; x < this.n; x++) fft(this.re, this.im, this._plan, inverse, x, this.n);
  }

  _cache(dt) {
    if (dt === this._cachedDt) return;
    this._cachedDt = dt;
    for (let i = 0; i < this.re.length; i++) {
      const v = -this.potential[i] * dt / 2, k = -this._k2[i] * dt / 2;
      this._vCos[i] = Math.cos(v); this._vSin[i] = Math.sin(v);
      this._vAmp[i] = Math.exp(-(this.absorber[i] + this.detector[i]) * dt / 2);
      this._kCos[i] = Math.cos(k); this._kSin[i] = Math.sin(k);
    }
  }

  _potentialHalfStep() {
    let left = 0, right = 0;
    const n = this.n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const index = j * n + i;
        const a = this.re[index], b = this.im[index], amp = this._vAmp[index];
        const loss = (a * a + b * b) * (1 - amp * amp);
        const edge = this.absorber[index], detector = this.detector[index], total = edge + detector;
        // Split competing loss channels by their non-Hermitian rates (no double counts).
        const detectorLoss = total > 0 ? loss * detector / total : 0;
        this.detectedProfile[j] += detectorLoss * this.dx * this.dx;
        this.detected += detectorLoss * this.dx * this.dx;
        const edgeLoss = loss - detectorLoss;
        if ((i - n / 2) * this.dx < this.params.barrierX) left += edgeLoss; else right += edgeLoss;
        this.re[index] = (a * this._vCos[index] - b * this._vSin[index]) * amp;
        this.im[index] = (a * this._vSin[index] + b * this._vCos[index]) * amp;
      }
    }
    const cell = this.dx * this.dx;
    this.absorbedLeft += left * cell;
    this.absorbedRight += right * cell;
    this.absorbed += (left + right) * cell;
  }

  step(dt, steps = 1) {
    validateStep(dt, steps);
    if (dt === 0 || steps === 0) return this;
    const subdivisions = Math.max(1, Math.ceil(dt / this.maxStep));
    const h = dt / subdivisions;
    this._cache(h);
    for (let s = 0; s < steps * subdivisions; s++) {
      this._potentialHalfStep();
      this._fft(false);
      rotate(this.re, this.im, this._kCos, this._kSin);
      this._fft(true);
      this._potentialHalfStep();
    }
    this.time += dt * steps;
    return this;
  }

  /**
   * transmitted: вероятность справа от стенки плюс поглощённая в правой полуплоскости.
   * Поглощение у верхней/нижней границы тоже относится к соответствующей полуплоскости.
   * Это пространственная оценка выхода пакета, не интеграл вероятностного тока.
   */
  stats() {
    let norm = 0, firstX = 0, firstY = 0, secondX = 0, transmitted = 0, barrier = 0;
    const rightEdge = this.params.barrierX + this.params.barrierWidth / 2;
    const leftEdge = this.params.barrierX - this.params.barrierWidth / 2;
    const n = this.n, dx = this.dx, cell = dx * dx;
    for (let j = 0; j < n; j++) {
      const y = (j - n / 2) * dx;
      for (let i = 0; i < n; i++) {
        const x = (i - n / 2) * dx, index = j * n + i;
        const q = (this.re[index] ** 2 + this.im[index] ** 2) * cell;
        norm += q; firstX += x * q; firstY += y * q; secondX += x * x * q;
        if (x > rightEdge) transmitted += q;
        else if (x >= leftEdge) barrier += q;
      }
    }
    const xMean = norm > 1e-15 ? firstX / norm : 0;
    return {
      norm, survival: norm, xMean, yMean: norm > 1e-15 ? firstY / norm : 0,
      sigmaX: norm > 1e-15 ? Math.sqrt(Math.max(0, secondX / norm - xMean * xMean)) : 0,
      transmitted: transmitted + this.absorbedRight,
      right: transmitted, left: norm - transmitted - barrier, barrier,
      absorbed: this.absorbed, absorbedLeft: this.absorbedLeft, absorbedRight: this.absorbedRight,
      detected: this.detected, // probability of one first click at detector up to time t
      accounted: norm + this.absorbed + this.detected,
    };
  }

  /** Мгновенная плотность |ψ(screenX,y)|²; не накопленные срабатывания детектора. */
  screenProfile(screenX = 8) {
    const i = Math.max(0, Math.min(this.n - 1, Math.round(screenX / this.dx + this.n / 2)));
    const density = new Float64Array(this.n);
    for (let j = 0; j < this.n; j++) {
      const index = j * this.n + i;
      density[j] = this.re[index] ** 2 + this.im[index] ** 2;
    }
    return density;
  }
}

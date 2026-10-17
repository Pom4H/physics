/**
 * Нормированные реальные орбитали невозмущённого атома водорода.
 *
 * Атомные единицы: a₀ = ħ = mₑ = e²/(4πε₀) = 1; ядро неподвижно,
 * H = −½∇² − 1/r, Eₙ = −1/(2n²). Спин, релятивистские поправки,
 * тонкая структура и многоэлектронные атомы здесь не моделируются.
 *
 * Реальные pₓ, dₓ𝓏, dₓᵧ — нормированные линейные комбинации состояний m.
 * Точки — независимые выборки положения из |ψ|², а не траектории электронов.
 * Стационарное состояние меняет общую фазу exp(−i E t), но не плотность.
 *
 * Формулы Rₙₗ и Yₗᵐ проверены по учебным материалам университетов:
 * https://interactivetextbooks.tudelft.nl/introduction-to-quantum-mechanics/content/equationsandconstants.html
 * https://books.physics.oregonstate.edu/GMM/hydroform.html
 */

const PI = Math.PI;
const INV_SQRT_PI = 1 / Math.sqrt(PI);
const S2 = 1 / (4 * Math.sqrt(2 * PI));
const DZ2 = 1 / (81 * Math.sqrt(6 * PI));
const DXY = Math.sqrt(2) / (81 * Math.sqrt(PI));
const INV_TWO32 = 1 / 4294967296;

/** Хвост целочисленного гамма-распределения: Γ(k,x)/Γ(k). */
function gammaSurvival(k, x) {
  if (x > 1024) return 0;
  let term = 1;
  let sum = 1;
  for (let j = 1; j < k; j++) {
    term *= x / j;
    sum += term;
  }
  return Math.exp(-x) * sum;
}

function survivalForFamily(family, r) {
  if (r > 1024) return 0;
  switch (family) {
    case '1s': return gammaSurvival(3, 2 * r);
    case '2s': {
      const r2 = r * r;
      return Math.exp(-r) * (1 + r + r2 / 2 + r2 * r2 / 8);
    }
    case '2p': return gammaSurvival(5, r);
    case '3d': return gammaSurvival(7, 2 * r / 3);
    default: throw new RangeError(`Неизвестное семейство орбиталей: ${family}`);
  }
}

/**
 * Доступные орбитали. domain — радиус конечной области выборки в a₀;
 * displayExtent — удобный масштаб камеры, а не физическая граница.
 * tailProbability — точная вероятность за пределами domain.
 * expectedRadius и expectedSquaredRadius относятся ко всей орбитали.
 */
export const ORBITALS = Object.freeze([
  {
    id: '1s', label: '1s', n: 1, l: 0, family: '1s', domain: 10, displayExtent: 5,
    radialNodes: [], angularNodeCount: 0,
    formula: 'ψ = e^(−r) / √π',
    description: 'Сферическая симметрия. Узлов нет.',
  },
  {
    id: '2s', label: '2s', n: 2, l: 0, family: '2s', domain: 26, displayExtent: 16,
    radialNodes: [2], angularNodeCount: 0,
    formula: 'ψ = (2 − r) e^(−r/2) / (4√(2π))',
    description: 'Радиальный узел r = 2 a₀ разделяет области разных знаков ψ.',
  },
  {
    id: '2pz', label: '2p z', n: 2, l: 1, family: '2p', domain: 26, displayExtent: 15,
    radialNodes: [], angularNodeCount: 1,
    formula: 'ψ = z e^(−r/2) / (4√(2π))',
    description: 'Две области по оси z. Узловая плоскость z = 0.',
  },
  {
    id: '2px', label: '2p x', n: 2, l: 1, family: '2p', domain: 26, displayExtent: 15,
    radialNodes: [], angularNodeCount: 1,
    formula: 'ψ = x e^(−r/2) / (4√(2π))',
    description: 'Две области по оси x. Узловая плоскость x = 0.',
  },
  {
    id: '3dz2', label: '3d z²', n: 3, l: 2, family: '3d', domain: 45, displayExtent: 28,
    radialNodes: [], angularNodeCount: 2,
    formula: 'ψ = (2z² − x² − y²) e^(−r/3) / (81√(6π))',
    description: 'Две области по оси z и кольцевая область противоположного знака.',
  },
  {
    id: '3dxz', label: '3d xz', n: 3, l: 2, family: '3d', domain: 45, displayExtent: 28,
    radialNodes: [], angularNodeCount: 2,
    formula: 'ψ = √2 xz e^(−r/3) / (81√π)',
    description: 'Четыре области. Узловые плоскости x = 0 и z = 0.',
  },
  {
    id: '3dxy', label: '3d xy', n: 3, l: 2, family: '3d', domain: 45, displayExtent: 28,
    radialNodes: [], angularNodeCount: 2,
    formula: 'ψ = √2 xy e^(−r/3) / (81√π)',
    description: 'Четыре области. Узловые плоскости x = 0 и y = 0.',
  },
].map((orbital) => {
  const n2 = orbital.n * orbital.n;
  const ll = orbital.l * (orbital.l + 1);
  const tailProbability = survivalForFamily(orbital.family, orbital.domain);
  return Object.freeze({
    ...orbital,
    radialNodes: Object.freeze(orbital.radialNodes),
    energy: -1 / (2 * n2),
    normalization: 1,
    expectedRadius: (3 * n2 - ll) / 2,
    expectedSquaredRadius: n2 * (5 * n2 + 1 - 3 * ll) / 2,
    tailProbability,
    retainedProbability: 1 - tailProbability,
  });
}));

const BY_ID = new Map(ORBITALS.map((orbital) => [orbital.id, orbital]));

function orbitalFor(id) {
  const orbital = BY_ID.get(id);
  if (!orbital) throw new RangeError(`Неизвестная орбиталь: ${id}`);
  return orbital;
}

function requireRadius(r) {
  if (!Number.isFinite(r) || r < 0) {
    throw new RangeError('Радиус должен быть конечным неотрицательным числом.');
  }
}

/**
 * Реальная пространственная волновая функция ψ(x,y,z), в a₀^(−3/2).
 * Аргументы x, y, z задаются в a₀. Противоположные знаки соответствуют
 * относительной фазе π; общий выбор знака орбитали условен.
 */
export function wavefunction(id, x, y, z) {
  orbitalFor(id);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new RangeError('Координаты должны быть конечными числами.');
  }
  const r = Math.hypot(x, y, z);
  // При таком радиусе даже наименее быстро затухающая 3d-функция
  // меньше минимального представимого double. Отсекаем до r², чтобы
  // огромные конечные входы не создавали неопределённость Infinity * 0.
  if (r > 4096) return 0;
  switch (id) {
    case '1s': return INV_SQRT_PI * Math.exp(-r);
    case '2s': return S2 * (2 - r) * Math.exp(-r / 2);
    case '2pz': return S2 * z * Math.exp(-r / 2);
    case '2px': return S2 * x * Math.exp(-r / 2);
    case '3dz2': return DZ2 * (2 * z * z - x * x - y * y) * Math.exp(-r / 3);
    case '3dxz': return DXY * x * z * Math.exp(-r / 3);
    case '3dxy': return DXY * x * y * Math.exp(-r / 3);
    default: return 0; // Недостижимо: id проверен выше.
  }
}

/** Плотность вероятности на единицу объёма: |ψ(x,y,z)|², в a₀^(−3). */
export function density(id, x, y, z) {
  const psi = wavefunction(id, x, y, z);
  return psi * psi;
}

/** Радиальная часть Rₙₗ(r), нормированная условием ∫r²|R|²dr = 1. */
export function radialWavefunction(id, r) {
  const { family } = orbitalFor(id);
  requireRadius(r);
  if (r > 4096) return 0;
  switch (family) {
    case '1s': return 2 * Math.exp(-r);
    case '2s': return (2 - r) * Math.exp(-r / 2) / (2 * Math.sqrt(2));
    case '2p': return r * Math.exp(-r / 2) / (2 * Math.sqrt(6));
    case '3d': return 4 * r * r * Math.exp(-r / 3) / (81 * Math.sqrt(30));
    default: return 0;
  }
}

/**
 * Плотность вероятности по радиусу: P(r) = r² |Rₙₗ(r)|².
 * P(r)dr — вероятность попадания в сферический слой [r,r+dr].
 * В отличие от |ψ|² здесь уже учтён сферический якобиан.
 */
export function radialProbability(id, r) {
  const radial = radialWavefunction(id, r);
  if (r > 4096) return 0;
  return r * r * radial * radial;
}

/** Точная аналитическая вероятность Pr(radius > r) без численного интегрирования. */
export function radialSurvival(id, r) {
  const { family } = orbitalFor(id);
  requireRadius(r);
  return survivalForFamily(family, r);
}

/** Воспроизводимый PRNG; выход строго между 0 и 1, поэтому log(U) конечен. */
function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) * INV_TWO32;
  };
}

/** Γ(k, rate=1): сумма k независимых экспонент, один вызов log. */
function integerGamma(k, random) {
  let product = 1;
  for (let j = 0; j < k; j++) product *= random();
  return -Math.log(product);
}

function sampleRadius(family, random) {
  switch (family) {
    case '1s': return integerGamma(3, random) / 2;
    case '2p': return integerGamma(5, random);
    case '3d': return 1.5 * integerGamma(7, random);
    case '2s': {
      // P₂s = r²(r−2)² e^(−r)/8.
      // q = ¾ Γ(5,1) + ¼ Γ(3,1) = (r⁴+4r²)e^(−r)/32.
      // P₂s ≤ 4q; acceptance = (r−2)²/(r²+4). Ровно ¼ в среднем.
      let r;
      do {
        r = integerGamma(random() < 0.75 ? 5 : 3, random);
      } while (random() * (r * r + 4) > (r - 2) * (r - 2));
      return r;
    }
    default: throw new RangeError(`Неизвестное семейство орбиталей: ${family}`);
  }
}

/**
 * Независимые выборки положения из |ψ|², условно на r ≤ domain.
 *
 * Радиус выбирается из точного r²|R|², направление — из |Y|² dΩ.
 * Для s направление равномерно по сфере; для p μ = cbrt(2U−1).
 * Для d используется rejection sampling с доказанными максимумами:
 * (3μ²−1)² ≤ 4 и 4uₓ²uⱼ² ≤ 1. Равномерная сфера требует
 * равномерного cos(θ), а не равномерного θ.
 *
 * Никаких случайных траекторий, анимации или подгонки формы облака нет.
 * Единственное пространственное приближение — отсечение указанного хвоста.
 *
 * @param {string} id Идентификатор из ORBITALS.
 * @param {number} count Количество точек, целое ≥ 0.
 * @param {number} [seed=1] Конечное целое seed для воспроизводимости.
 * @returns {{positions: Float32Array, phases: Float32Array, radii: Float32Array,
 *   domain: number, retainedProbability: number, tailProbability: number}}
 */
export function sampleOrbital(id, count, seed = 1) {
  const orbital = orbitalFor(id);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Количество точек должно быть неотрицательным целым числом.');
  }
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed должен быть целым числом.');

  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const radii = new Float32Array(count);
  const random = randomGenerator(seed);

  for (let i = 0; i < count; i++) {
    let r;
    do { r = sampleRadius(orbital.family, random); } while (r > orbital.domain);

    let ux;
    let uy;
    let uz;
    let sign = 1;
    if (orbital.l === 0) {
      uz = 2 * random() - 1;
      const phi = 2 * PI * random();
      const horizontal = Math.sqrt(Math.max(0, 1 - uz * uz));
      ux = horizontal * Math.cos(phi);
      uy = horizontal * Math.sin(phi);
      if (id === '2s') sign = 2 - r;
    } else if (orbital.l === 1) {
      const axis = Math.cbrt(2 * random() - 1);
      const phi = 2 * PI * random();
      const transverse = Math.sqrt(Math.max(0, 1 - axis * axis));
      if (id === '2pz') {
        ux = transverse * Math.cos(phi);
        uy = transverse * Math.sin(phi);
        uz = axis;
      } else {
        ux = axis;
        uy = transverse * Math.cos(phi);
        uz = transverse * Math.sin(phi);
      }
      sign = axis;
    } else if (id === '3dz2') {
      do {
        uz = 2 * random() - 1;
        sign = 3 * uz * uz - 1;
      } while (4 * random() > sign * sign);
      const phi = 2 * PI * random();
      const horizontal = Math.sqrt(Math.max(0, 1 - uz * uz));
      ux = horizontal * Math.cos(phi);
      uy = horizontal * Math.sin(phi);
    } else {
      do {
        uz = 2 * random() - 1;
        const phi = 2 * PI * random();
        const horizontal = Math.sqrt(Math.max(0, 1 - uz * uz));
        ux = horizontal * Math.cos(phi);
        uy = horizontal * Math.sin(phi);
        sign = ux * (id === '3dxz' ? uz : uy);
      } while (random() > 4 * sign * sign);
    }

    positions[3 * i] = r * ux;
    positions[3 * i + 1] = r * uy;
    positions[3 * i + 2] = r * uz;
    phases[i] = sign < 0 ? PI : 0;
    radii[i] = r;
  }

  return {
    positions, phases, radii, domain: orbital.domain,
    retainedProbability: orbital.retainedProbability,
    tailProbability: orbital.tailProbability,
  };
}

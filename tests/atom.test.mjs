import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ORBITALS, wavefunction, density, radialWavefunction,
  radialProbability, radialSurvival, sampleOrbital,
} from '../dist/physics/atom.mjs';

function close(actual, expected, tolerance, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: ${actual} differs from ${expected} by ${Math.abs(actual - expected)} > ${tolerance}`);
}

function simpson(fn, limit, intervals = 10000) {
  const h = limit / intervals;
  let sum = fn(0) + fn(limit);
  for (let i = 1; i < intervals; i++) sum += (i & 1 ? 4 : 2) * fn(i * h);
  return sum * h / 3;
}

// 5-point Gauss–Legendre integrates the relevant angular polynomials exactly.
const MU = [0, 0.5384693101056831, -0.5384693101056831, 0.9061798459386640, -0.9061798459386640];
const WEIGHT = [0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891, 0.2369268850561891];

function angularIntegral(id, component = () => 1) {
  const radius = 1;
  const radial = radialWavefunction(id, radius);
  let sum = 0;
  for (let j = 0; j < MU.length; j++) {
    const z = MU[j];
    const horizontal = Math.sqrt(1 - z * z);
    for (let k = 0; k < 16; k++) {
      const phi = 2 * Math.PI * k / 16;
      const x = horizontal * Math.cos(phi);
      const y = horizontal * Math.sin(phi);
      sum += WEIGHT[j] * (2 * Math.PI / 16) *
        density(id, x, y, z) / (radial * radial) * component(x, y, z);
    }
  }
  return sum;
}

test('All seven real hydrogen orbitals normalize over 3D space', () => {
  for (const orbital of ORBITALS) {
    const radialNorm = simpson((r) => radialProbability(orbital.id, r), orbital.domain);
    const angularNorm = angularIntegral(orbital.id);
    close(angularNorm, 1, 2e-13, `${orbital.id} angular normalization`);
    close(radialNorm + orbital.tailProbability, 1, 2e-10, `${orbital.id} radial normalization`);
    close(radialNorm * angularNorm + orbital.tailProbability, 1, 2e-10, `${orbital.id} 3D normalization`);
    assert.ok(orbital.tailProbability > 0 && orbital.tailProbability < 5e-7);
  }
});

test('Radial means and second moments equal independent hydrogen identities', () => {
  for (const orbital of ORBITALS) {
    // 160 a₀ makes missing n ≤ 3 moments negligible at the asserted precision.
    const mean = simpson((r) => r * radialProbability(orbital.id, r), 160, 40000);
    const square = simpson((r) => r * r * radialProbability(orbital.id, r), 160, 40000);
    close(mean, orbital.expectedRadius, 2e-9, `${orbital.id} mean radius`);
    close(square, orbital.expectedSquaredRadius, 2e-9, `${orbital.id} squared radius`);
  }
});

test('Radial tail formula differentiates to minus the radial density', () => {
  for (const orbital of ORBITALS) {
    close(radialSurvival(orbital.id, 0), 1, 1e-15);
    for (const r of [0.3, 1, 2.4, 5, 11, 25]) {
      const h = 1e-4;
      const derivative = (radialSurvival(orbital.id, r + h) - radialSurvival(orbital.id, r - h)) / (2 * h);
      close(derivative, -radialProbability(orbital.id, r), 7e-9, `${orbital.id} at r=${r}`);
    }
  }
});

test('Cartesian wavefunctions satisfy Hψ = Eψ away from the Coulomb singularity', () => {
  const points = [[0.7, 0.8, 1.2], [1.1, -2.3, 0.4], [-2.2, 1.7, 3.4]];
  const h = 0.0005;
  for (const orbital of ORBITALS) {
    for (const point of points) {
      const psi = wavefunction(orbital.id, ...point);
      let laplacian = 0;
      for (let axis = 0; axis < 3; axis++) {
        const plus = [...point];
        const minus = [...point];
        plus[axis] += h;
        minus[axis] -= h;
        laplacian += (wavefunction(orbital.id, ...plus) - 2 * psi + wavefunction(orbital.id, ...minus)) / (h * h);
      }
      const radius = Math.hypot(...point);
      const hPsi = -0.5 * laplacian - psi / radius;
      const energyPsi = orbital.energy * psi;
      close(hPsi, energyPsi, Math.max(Math.abs(energyPsi), Math.abs(psi / radius)) * 3e-6,
        `${orbital.id} stationary Schrödinger equation`);
    }
  }
});

test('Radial and angular nodes have zero probability and the right sign change', () => {
  close(wavefunction('2s', 2, 0, 0), 0, 1e-15);
  assert.ok(wavefunction('2s', 1.9, 0, 0) > 0);
  assert.ok(wavefunction('2s', 2.1, 0, 0) < 0);
  close(wavefunction('2pz', 1, 2, 0), 0, 1e-15);
  close(wavefunction('2px', 0, 2, 1), 0, 1e-15);
  close(wavefunction('3dz2', 1, 1, 1), 0, 1e-15);
  close(wavefunction('3dxz', 0, 2, 1), 0, 1e-15);
  close(wavefunction('3dxz', 1, 2, 0), 0, 1e-15);
  close(wavefunction('3dxy', 0, 2, 1), 0, 1e-15);
  close(wavefunction('3dxy', 1, 0, 2), 0, 1e-15);
  for (const id of ['2pz', '3dxz']) {
    close(wavefunction(id, 1, 2, -3), -wavefunction(id, 1, 2, 3), 1e-15);
  }
  for (const id of ['2px', '3dxy']) {
    close(wavefunction(id, -1, 2, 3), -wavefunction(id, 1, 2, 3), 1e-15);
  }
});

test('Point sampling reproduces radial CDFs and angular second moments', () => {
  const count = 60000;
  for (const orbital of ORBITALS) {
    const sampled = sampleOrbital(orbital.id, count, 98765);
    const angular = [0, 0, 0];
    const halfMean = orbital.expectedRadius / 2;
    const cutoffs = [halfMean, orbital.expectedRadius, orbital.expectedRadius * 1.5];
    const below = [0, 0, 0];
    let mean = 0;
    for (let i = 0; i < count; i++) {
      const radius = sampled.radii[i];
      assert.ok(radius > 0 && radius <= orbital.domain);
      mean += radius;
      for (let axis = 0; axis < 3; axis++) {
        const u = sampled.positions[3 * i + axis] / radius;
        angular[axis] += u * u;
        if (radius <= cutoffs[axis]) below[axis]++;
      }
      if (i % 101 === 0) {
        const psi = wavefunction(orbital.id, ...sampled.positions.subarray(3 * i, 3 * i + 3));
        close(sampled.phases[i], psi < 0 ? Math.PI : 0, 1e-6, `${orbital.id} sampled phase`);
      }
    }
    const radialVariance = orbital.expectedSquaredRadius - orbital.expectedRadius ** 2;
    close(mean / count, orbital.expectedRadius, 6 * Math.sqrt(radialVariance / count), `${orbital.id} sampled radius`);
    for (let axis = 0; axis < 3; axis++) {
      const cdf = (1 - radialSurvival(orbital.id, cutoffs[axis])) / sampled.retainedProbability;
      close(below[axis] / count, cdf, 6 * Math.sqrt(cdf * (1 - cdf) / count) + 1 / count,
        `${orbital.id} radial CDF at ${cutoffs[axis]}`);
      const expected = angularIntegral(orbital.id, (x, y, z) => [x, y, z][axis] ** 2);
      close(angular[axis] / count, expected, 0.007, `${orbital.id} angular second moment axis ${axis}`);
    }
  }
});

test('Sampling is seeded, static, finite, and reports its truncation explicitly', () => {
  const a = sampleOrbital('3dz2', 100, 42);
  const b = sampleOrbital('3dz2', 100, 42);
  const c = sampleOrbital('3dz2', 100, 43);
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.phases, b.phases);
  assert.notDeepEqual(a.positions, c.positions);
  assert.ok(a.positions.every(Number.isFinite));
  close(a.retainedProbability + a.tailProbability, 1, 1e-15);
  assert.equal(sampleOrbital('1s', 0).positions.length, 0);
  assert.throws(() => sampleOrbital('1s', -1), RangeError);
  assert.throws(() => sampleOrbital('1s', 1.5), RangeError);
  assert.throws(() => wavefunction('unknown', 0, 0, 0), RangeError);
  assert.throws(() => radialProbability('1s', -1), RangeError);
});

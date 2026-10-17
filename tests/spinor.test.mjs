import test from 'node:test';
import assert from 'node:assert/strict';
import { Spinor1D } from '../dist/physics/spinor.mjs';

const TAU = 2 * Math.PI;

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`);
}

function componentDistance(a, b, dx, factor = 1) {
  let sum = 0;
  for (let i = 0; i < a.re.length; i++) {
    sum += (a.re[i] - factor * b.re[i]) ** 2 + (a.im[i] - factor * b.im[i]) ** 2;
  }
  return Math.sqrt(sum * dx);
}

test('the three models share the same positive-momentum probability distribution and conserve norm', () => {
  const models = ['pauli', 'dirac', 'weyl'].map((model) => new Spinor1D({ model }));
  for (const q of models) {
    assert.deepEqual(q.spectralProbability, models[0].spectralProbability, 'identical normalized |A(k)|²');
    close(q.spectralProbability.reduce((sum, value) => sum + value, 0), 1, 2e-15, 'spectral probability');
    for (let i = 0; i < q.n; i++) if (q.pgrid[i] <= 0) assert.equal(q.spectralProbability[i], 0);
    for (const time of [0, 1.7, 6.2, 13.8]) {
      q.setTime(time);
      close(q.stats().norm, 1, 2e-14, `${q.model} norm at ${time}`);
      close(q.stats().meanVelocity, q.stats().meanGroupVelocity, 2e-14, 'position-space current agrees with dispersion');
      for (let i = 0; i < q.n; i++) {
        let sum = 0;
        for (let a = 0; a < q.components.length; a++) sum += q.componentDensity[a][i];
        close(q.density[i], sum, 1e-16, 'density is the component sum');
      }
    }
  }
  assert.equal(models[0].stats().positiveEnergyFraction, null, 'Pauli has no relativistic branch label');
  assert.equal(models[1].stats().positiveEnergyFraction, 1);
  assert.equal(models[2].stats().positiveEnergyFraction, 1);
});

test('Dirac initial states independently satisfy H(k) u(k) = +E(k) u(k) in the stated chiral basis', () => {
  for (const helicity of [-1, 1]) {
    const q = new Spinor1D({ model: 'dirac', mass: 1.3, c: 1.7, hbar: 0.8, helicity });
    const massEnergy = q.params.mass * q.params.c ** 2;
    let residual = 0, energyNorm = 0;
    for (let i = 0; i < q.n; i++) {
      const cp = q.params.c * q.pgrid[i];
      const energy = Math.hypot(cp, massEnergy);
      for (const part of ['re', 'im']) {
        const [lu, ld, ru, rd] = q.initialSpectrum.map((state) => state[part][i]);
        const state = [lu, ld, ru, rd];
        const hState = [-cp * ld + massEnergy * ru, -cp * lu + massEnergy * rd,
          massEnergy * lu + cp * rd, massEnergy * ld + cp * ru];
        for (let a = 0; a < 4; a++) {
          residual += (hState[a] - energy * state[a]) ** 2;
          energyNorm += energy ** 2 * state[a] ** 2;
        }
      }
    }
    assert.ok(Math.sqrt(residual / energyNorm) < 4e-16, 'positive-energy Hamiltonian residual');
    close(q.stats().spinX, helicity, 4e-15, 'helicity along the positive momentum axis');
    assert.ok(q.stats().leftWeight > 0 && q.stats().rightWeight > 0, 'massive state contains both chiralities');
  }
});

test('at zero mass Dirac decouples exactly into the matching left or right Weyl spinor', () => {
  for (const chirality of [-1, 1]) {
    const dirac = new Spinor1D({ model: 'dirac', mass: 0, helicity: chirality });
    const weyl = new Spinor1D({ model: 'weyl', chirality });
    const offset = chirality === -1 ? 0 : 2;
    for (const time of [0, 3.2, 15]) {
      dirac.setTime(time); weyl.setTime(time);
      for (let a = 0; a < 2; a++) {
        close(componentDistance(dirac.components[a + offset], weyl.components[a], dirac.dx), 0, 1e-15, 'Weyl embedding');
        const zero = dirac.componentDensity[a + (offset === 0 ? 2 : 0)];
        assert.equal(zero.reduce((sum, value) => sum + value, 0), 0, 'opposite chirality stays exactly zero');
      }
      close(dirac.stats().meanVelocity, 1, 2e-15, 'both positive-energy chiralities propagate forward');
      close(weyl.stats().spinX, chirality, 2e-15, 'spin reverses with chirality');
      close(dirac.stats().leftWeight, chirality === -1 ? 1 : 0, 2e-14, 'pure left chirality when selected');
      close(dirac.stats().rightWeight, chirality === 1 ? 1 : 0, 2e-14, 'pure right chirality when selected');
    }
  }
});

test('the one-dimensional Weyl packet translates at c without dispersion', () => {
  const q = new Spinor1D({ model: 'weyl', n: 1024, length: 128, x0: -12, c: 1.25, chirality: -1 });
  const initial = q.density.slice(), before = q.stats();
  const time = 8, shift = Math.round(q.params.c * time / q.dx);
  q.setTime(time);
  for (let i = 0; i < q.n; i++) close(q.density[i], initial[(i - shift + q.n) % q.n], 4e-16, 'rigid density translation');
  close(q.stats().xMean, before.xMean + q.params.c * time, 2e-11, 'centroid speed c');
  close(q.stats().sigmaX, before.sigmaX, 2e-11, 'constant width');
  assert.ok(q.stats().periodicEdgeProbability < 1e-13, 'packet stays clear of the periodic edges');
});

test('massive Dirac propagation has subluminal group velocity and constant integrated chirality for this E+ preparation', () => {
  for (const helicity of [-1, 1]) {
    const q = new Spinor1D({ model: 'dirac', helicity, mass: 1 });
    const before = q.stats();
    let predictedVelocity = 0, predictedChirality = 0;
    for (let i = 0; i < q.n; i++) {
      const p = q.pgrid[i], probability = q.spectralProbability[i];
      const ratio = p / Math.hypot(p, q.params.mass);
      predictedVelocity += probability * ratio;
      predictedChirality += probability * helicity * ratio;
    }
    q.setTime(12);
    const after = q.stats();
    assert.ok(after.meanVelocity > 0 && after.meanVelocity < q.params.c);
    close(after.meanVelocity, predictedVelocity, 4e-15, 'dispersion group velocity');
    close(after.xMean, before.xMean + 12 * predictedVelocity, 2e-10, 'packet centroid');
    close(after.meanChirality, predictedChirality, 4e-15, 'chiral expectation');
    close(after.leftWeight, before.leftWeight, 3e-15, 'no invented free L↔R probability oscillation');
    close(after.leftWeight + after.rightWeight, 1, 2e-15, 'chiral weights sum to one');
    for (let i = 0; i < q.n; i++) {
      assert.ok(Math.abs(q.currentDensity[i]) <= q.params.c * q.density[i] + 2e-16, 'causal Dirac probability current');
      if (q.density[i] > 1e-8) close(q.spinX[i], helicity, 4e-15, 'local spin polarization');
    }
  }
});

test('the Pauli effective spin term gives the signed Bloch precession and a 360° spinor sign change', () => {
  const omega = 0.8, theta = 0.9, phi = -0.4;
  const q = new Spinor1D({ model: 'pauli', omega, theta, phi });
  const reference = new Spinor1D({ model: 'pauli', omega: 0, theta, phi });
  for (const time of [1.3, 2.7, TAU / omega, 2 * TAU / omega]) {
    q.setTime(time); reference.setTime(time);
    close(q.stats().spinX, Math.sin(theta) * Math.cos(phi + omega * time), 3e-15, 'precession x');
    close(q.stats().spinY, Math.sin(theta) * Math.sin(phi + omega * time), 3e-15, 'precession y');
    close(q.stats().spinZ, Math.cos(theta), 3e-15, 'precession z');
    for (let i = 0; i < q.n; i++) close(q.density[i], reference.density[i], 4e-16, 'uniform spin rotation leaves density unchanged');
  }
  q.setTime(TAU / omega); reference.setTime(TAU / omega);
  for (let a = 0; a < 2; a++) close(componentDistance(q.components[a], reference.components[a], q.dx, -1), 0, 3e-15, '2pi rotation multiplies the spinor by -1');
  q.setTime(2 * TAU / omega); reference.setTime(2 * TAU / omega);
  for (let a = 0; a < 2; a++) close(componentDistance(q.components[a], reference.components[a], q.dx), 0, 6e-15, '4pi restores the spinor');
  // This sign is not a change of probability or spin vector; a relative
  // reference is needed to observe it interferometrically.
});

test('after removing rest energy, the Dirac large component approaches Pauli with O(c^-2) error', (t) => {
  const time = 4;
  const pauli = new Spinor1D({ model: 'pauli', mass: 1, helicity: 1 });
  pauli.setTime(time);
  const errors = [];
  for (const c of [12, 24, 48]) {
    const dirac = new Spinor1D({ model: 'dirac', c, mass: 1, helicity: 1 });
    dirac.setTime(time);
    const restPhase = dirac.params.mass * c ** 2 * time / dirac.params.hbar;
    const cos = Math.cos(restPhase), sin = Math.sin(restPhase);
    let error = 0, smallNorm = 0;
    for (let a = 0; a < 2; a++) {
      const left = dirac.components[a], right = dirac.components[a + 2], target = pauli.components[a];
      for (let i = 0; i < dirac.n; i++) {
        // Chiral to ordinary Dirac basis: large=(L+R)/sqrt(2).
        const re = (left.re[i] + right.re[i]) / Math.sqrt(2);
        const im = (left.im[i] + right.im[i]) / Math.sqrt(2);
        error += ((re * cos - im * sin) - target.re[i]) ** 2
          + ((re * sin + im * cos) - target.im[i]) ** 2;
        smallNorm += ((right.re[i] - left.re[i]) ** 2 + (right.im[i] - left.im[i]) ** 2) / 2;
      }
    }
    errors.push(Math.sqrt(error * dirac.dx));
    assert.ok(smallNorm * dirac.dx < 0.005, 'negative standard-basis small component is suppressed');
    close(dirac.stats().nonrelativisticRatio, dirac.stats().rmsMomentum / c, 1e-16, 'p_rms/(mc)');
  }
  assert.ok(errors[2] < 0.0022, `large-c state error: ${errors[2]}`);
  for (let i = 1; i < errors.length; i++) {
    const ratio = errors[i] / errors[i - 1];
    assert.ok(ratio > 0.24 && ratio < 0.27, `doubling c quarters the leading error: ${ratio}`);
  }
  t.diagnostic(JSON.stringify({ c: [12, 24, 48], largeComponentL2Error: errors }));
});

test('absolute-time evolution is reversible without accumulated normalization or integration error', () => {
  const q = new Spinor1D({ model: 'dirac' });
  q.setTime(2.75);
  const checkpoint = q.components.map((state) => ({ re: state.re.slice(), im: state.im.slice() }));
  for (let i = 0; i < 300; i++) q.step(0.03);
  q.setTime(2.75);
  for (let a = 0; a < q.components.length; a++) {
    assert.deepEqual(q.components[a].re, checkpoint[a].re, 'same absolute time reproduces real components');
    assert.deepEqual(q.components[a].im, checkpoint[a].im, 'same absolute time reproduces imaginary components');
  }
  close(q.stats().norm, 1, 2e-14, 'no step renormalization needed');
});

test('massless and very small masses stay finite; invalid physical or grid parameters are rejected', () => {
  const tiny = new Spinor1D({ model: 'dirac', mass: 1e-12 });
  assert.ok(tiny.stats().leftWeight > 0, 'stable small component does not cancel to zero');
  tiny.setTime(9);
  close(tiny.stats().norm, 1, 2e-14, 'near-massless norm');
  for (const state of tiny.components) for (const value of state.re) assert.ok(Number.isFinite(value));
  for (const params of [
    { model: 'pauli', mass: 0 }, { mass: -1 }, { c: 0 }, { hbar: 0 },
    { n: 100 }, { sigma: 0 }, { k0: 0 }, { helicity: 0 },
    { model: 'weyl', chirality: 0 }, { theta: 4 }, { x0: 100 }, { model: 'unknown' },
  ]) assert.throws(() => new Spinor1D(params), RangeError);
  assert.throws(() => tiny.setTime(NaN), RangeError);
  assert.throws(() => tiny.setTime(-1), RangeError);
  assert.throws(() => tiny.step(0.1, 0.5), RangeError);
});

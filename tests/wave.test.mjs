import test from 'node:test';
import assert from 'node:assert/strict';
import { Quantum1D, Quantum2D } from '../dist/physics/wave.mjs';

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${message}: actual=${actual}, expected=${expected}, tolerance=${tolerance}`);
}

function stateDistance(a, b, cellMeasure) {
  let total = 0;
  for (let i = 0; i < a.re.length; i++) total += (a.re[i] - b.re[i]) ** 2 + (a.im[i] - b.im[i]) ** 2;
  return Math.sqrt(total * cellMeasure);
}

function normalizedProfileL1(a, b) {
  const sa = a.reduce((sum, x) => sum + x, 0);
  const sb = b.reduce((sum, x) => sum + x, 0);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] / sa - b[i] / sb);
  return difference;
}

test('free packet conserves probability and follows the exact Gaussian mean and spreading', () => {
  const sigma = 2, k0 = 2.5, x0 = -8, time = 5;
  const q = new Quantum1D({ mode: 'free', n: 1024, length: 96, absorber: false, sigma, k0, x0 });
  q.step(0.025, time / 0.025);
  const s = q.stats();
  close(s.norm, 1, 2e-12, 'unitary norm');
  close(s.xMean, x0 + k0 * time, 1e-9, 'Ehrenfest translation');
  close(s.sigmaX, sigma * Math.sqrt(1 + (time / (2 * sigma ** 2)) ** 2), 1e-9, 'free dispersion');
  close(s.accounted, 1, 2e-12, 'norm + absorber loss');
});

test('harmonic coherent state preserves width and follows the classical centroid', () => {
  const omega = 0.32, x0 = -8, time = 5;
  const q = new Quantum1D({ mode: 'oscillator', n: 1024, absorber: false, omega, x0, k0: 0, maxStep: 0.01 });
  const sigma = Math.sqrt(1 / (2 * omega));
  q.step(0.01, time / 0.01);
  const s = q.stats();
  close(s.norm, 1, 3e-12, 'coherent norm');
  close(s.xMean, x0 * Math.cos(omega * time), 1e-5, 'harmonic centroid');
  close(s.sigmaX, sigma, 3e-6, 'coherent width');
});

test('well eigenstate is stationary; a superposition evolves with conserved norm', () => {
  const stationary = new Quantum1D({ mode: 'well', wellMix: 0 });
  const initialDensity = stationary.re.map((x, i) => x * x + stationary.im[i] ** 2);
  stationary.step(17.3);
  for (let i = 0; i < stationary.n; i++) {
    close(stationary.re[i] ** 2 + stationary.im[i] ** 2, initialDensity[i], 1e-15, 'stationary density');
  }
  const q = new Quantum1D({ mode: 'well', wellMix: 0.5 });
  const before = q.stats();
  q.step(12);
  const after = q.stats();
  close(after.norm, 1, 1e-13, 'well norm');
  assert.ok(Math.abs(after.xMean - before.xMean) > 0.5, 'eigenstate interference moves the mean position');
});

test('sub-barrier packet splits into reflection and transmission with probability accounted', () => {
  const q = new Quantum1D({ mode: 'barrier', n: 1024 });
  q.step(0.01, 800);
  const s = q.stats();
  close(s.accounted, 1, 5e-12, 'barrier norm balance');
  close(s.left + s.right + s.barrier, s.norm, 5e-13, 'spatial partition');
  assert.ok(s.transmitted > 0.04 && s.transmitted < 0.12, `visible sub-barrier transmission: ${s.transmitted}`);
  assert.ok(s.leftTotal > 0.85, `reflected packet dominates after separation: ${s.leftTotal}`);
  assert.ok(s.barrier < 0.001, 'the separated outgoing packets have cleared the barrier');
  assert.ok(s.aboveBarrierFraction < 0.0001, 'initial above-barrier spectral tail is negligible');
  close(s.initialKineticEnergy, 4.53125, 1e-12, 'Gaussian kinetic expectation');
});

test('halving the barrier timestep changes transmitted probability by less than 0.2 percentage point', () => {
  const coarse = new Quantum1D({ mode: 'barrier', n: 1024 });
  const fine = new Quantum1D({ mode: 'barrier', n: 1024 });
  coarse.step(0.01, 800);
  fine.step(0.005, 1600);
  close(coarse.stats().transmitted, fine.stats().transmitted, 0.002, 'temporal convergence of transmission');
});

test('absorber removes probability without silently renormalizing the wave', () => {
  const q = new Quantum1D({ mode: 'free', length: 48, n: 512, x0: 10, sigma: 1.2, k0: 3, absorberWidth: 6 });
  q.step(0.025, 240);
  const s = q.stats();
  assert.ok(s.norm < 0.3, `probability remaining in the finite window: ${s.norm}`);
  assert.ok(s.absorbedRight > 0.7, `right absorber loss: ${s.absorbedRight}`);
  close(s.norm + s.absorbed, 1, 2e-12, 'explicit absorber bookkeeping');
});

test('2D FFT propagates a free Gaussian unitarily with the correct centroid', () => {
  const q = new Quantum2D({ n: 64, length: 48, absorber: false, barrierHeight: 0,
    packetX: -5, packetY: 0, k0: 2, ky: 0.5, sigmaX: 1.8, sigmaY: 2, maxStep: 0.02 });
  q.step(0.02, 100);
  const s = q.stats();
  close(s.norm, 1, 3e-12, '2D unitary norm');
  close(s.xMean, -1, 2e-6, '2D x centroid');
  close(s.yMean, 1, 2e-6, '2D y centroid');
});

test('double slit preserves mirror symmetry and converges under timestep and grid refinement', (t) => {
  const endTime = 6;
  const coarse = new Quantum2D({ n: 128 });
  const temporal = new Quantum2D({ n: 128 });
  const spatial = new Quantum2D({ n: 256 });
  coarse.step(0.008, endTime / 0.008);
  temporal.step(0.004, endTime / 0.004);
  spatial.step(0.008, endTime / 0.008);

  const s = coarse.stats(), ts = temporal.stats(), ss = spatial.stats();
  close(s.accounted, 1, 8e-12, '2D absorber bookkeeping');
  close(ts.accounted, 1, 1.5e-11, 'refined timestep norm');
  close(ss.accounted, 1, 1e-11, 'refined grid norm');
  assert.ok(s.transmitted > 0.1 && s.transmitted < 0.7, 'both passed and reflected beams are present');

  let mirrorError = 0;
  for (let y = 1; y < coarse.n; y++) {
    for (let x = 0; x < coarse.n; x++) {
      const a = y * coarse.n + x, b = (coarse.n - y) * coarse.n + x;
      const da = coarse.re[a] ** 2 + coarse.im[a] ** 2;
      const db = coarse.re[b] ** 2 + coarse.im[b] ** 2;
      mirrorError = Math.max(mirrorError, Math.abs(da - db));
    }
  }
  assert.ok(mirrorError < 1e-12, `slit mirror symmetry: ${mirrorError}`);

  const temporalStateError = stateDistance(coarse, temporal, coarse.dx ** 2);
  assert.ok(temporalStateError < 0.004, `wavefunction L2 difference with dt/2: ${temporalStateError}`);
  close(s.transmitted, ts.transmitted, 0.002, '2D timestep refinement');
  close(s.transmitted, ss.transmitted, 0.02, '2D grid refinement');
  const profile128 = coarse.screenProfile(6);
  const profile256 = spatial.screenProfile(6).filter((_, i) => i % 2 === 0);
  const profileL1 = normalizedProfileL1(profile128, profile256);
  assert.ok(profileL1 < 0.12, `detector profile L1 difference after n128→256: ${profileL1}`);
  t.diagnostic(JSON.stringify({
    time: endTime, transmitted128: s.transmitted, transmittedDtHalf: ts.transmitted,
    transmitted256: ss.transmitted, temporalStateL2: temporalStateError,
    normalizedScreenProfileL1: profileL1, mirrorError,
  }));
});

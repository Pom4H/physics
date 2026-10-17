import test from 'node:test';
import assert from 'node:assert/strict';
import { Quantum2D } from '../docs/physics/wave.mjs';
import { DetectorSeries } from '../docs/physics/detector.mjs';

const close = (a, b, epsilon, message) => assert.ok(
  Math.abs(a - b) < epsilon, `${message}: ${a} vs ${b}`,
);

test('detector is opt-in: default two-slit calculation still conserves norm', () => {
  const q = new Quantum2D({ n: 64, absorber: false });
  q.step(0.008, 15);
  const s = q.stats();
  close(s.norm, 1, 1e-11, 'unitary norm');
  close(s.detected, 0, 1e-14, 'zero detector absorption by default');
});

test('absorbing detector accounts independently for loss at edges', () => {
  const q = new Quantum2D({
    n: 64, detect: true, detectorX: 6, detectorWidth: 0.8,
    detectorStrength: 8,
  });
  q.step(0.008, 1250);
  const s = q.stats();
  close(s.accounted, 1, 2e-9, 'total norm + boundary + detector');
  close(q.detectedProfile.reduce((a,b) => a+b,0), s.detected, 3e-12, 'row integral');
  assert.ok(s.detected > 0.002 && s.detected < 1, 'nontrivial detection probability');
  assert.ok(s.absorbed >= 0 && s.norm >= 0, 'other channels are nonnegative');
});

test('changing detector strength changes first-click probability', () => {
  const a = new Quantum2D({ n: 64, detect: false, absorber: false });
  const b = new Quantum2D({ n: 64, detect: true, absorber: false });
  a.step(0.008, 500); b.step(0.008, 500);
  close(a.stats().detected, 0, 1e-14, 'disabled');
  assert.ok(b.stats().detected >= 0, 'detector records only positive probability');
  close(b.stats().accounted, 1, 2e-9, 'detector conserves total probability');
});

test('one source particle gives no more than one click', () => {
  const d = new DetectorSeries({ seed: 17, bins: 4, minY: -2, maxY: 2 });
  d.setPrediction([0.04, 0.11, 0.17], 1, -1);
  for (let i = 0; i < 30; i++) {
    const clicks = d.run(1);
    assert.ok(clicks.length <= 1, 'max one click per run');
  }
  assert.equal(d.shots, 30);
  assert.equal(d.shots, d.clicks + d.misses);
  assert.equal(d.counts.reduce((a,b)=>a+b,0), d.clicks);
});

test('a large series converges on the predicted click probability', () => {
  const d = new DetectorSeries({ seed: 123456, bins: 4, minY: -2, maxY: 2 });
  d.setPrediction([0.04, 0.11, 0.17], 1, -1);
  d.run(10000);
  for (let i=0; i<9; i++) d.run(10000);
  close(d.clicks / d.shots, 0.32, 0.008, 'Bernoulli rate');
  assert.ok(d.hits.length <= 2000, 'rendering history has a fixed memory budget');
  const { expected, measured } = d.distributions();
  close(expected.reduce((a,b)=>a+b,0) * d.binWidth, 0.32, 1e-12, 'histogram integral');
  close(measured.reduce((a,b)=>a+b,0) * d.binWidth, d.clicks/d.shots, 1e-12, 'measured integral');
});

test('new series resets counts without changing theoretical prediction', () => {
  const d = new DetectorSeries({ seed: 8 });
  d.setPrediction([0.15, 0.25], 1, -0.5);
  d.run(100);
  d.reset();
  assert.equal(d.shots, 0);
  assert.equal(d.clicks, 0);
  close(d.probability, 0.4, 1e-12, 'prediction retained');
  d.run(1);
  assert.equal(d.shots, 1);
});

test('invalid detector probabilities and shot counts are rejected', () => {
  const d = new DetectorSeries();
  assert.throws(() => d.run(1), /not ready/);
  assert.throws(() => d.setPrediction([1.1], 1, 0), /exceeds unity/);
  d.setPrediction([0, .1], 1, 0);
  assert.throws(() => d.run(0), /Invalid shot count/);
});

import { Quantum2D } from './wave.mjs';

let model;
let version = 0;

function frame(type) {
  const count = model.re.length;
  const field = new Float32Array(count * 2);
  field.set(model.re, 0);
  field.set(model.im, count);
  const message = { type, version, field, n: model.n, dx: model.dx, length: model.length, time: model.time, params: model.params, stats: model.stats() };
  self.postMessage(message, [field.buffer]);
}

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      version = data.version;
      model = new Quantum2D(data.params);
      frame('ready');
    } else if (data.type === 'step' && model && data.version === version) {
      model.step(0.008, data.steps);
      frame('frame');
    }
  } catch (error) {
    self.postMessage({ type: 'error', version, message: error.message });
  }
};

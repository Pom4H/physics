import { DetectorSeries } from './physics/detector.mjs';

/**
 * Measurement UI for the double-slit simulation. Physics stays in Quantum2D;
 * drawing the histogram never advances or renormalizes the wave.
 */
export class DetectorUI {
  constructor() {
    this.sequence = 0;
    this.series = new DetectorSeries();
    this.ready = false;
    this.view = 'hits';
    this.points = null;
    this.scale = .7;
  }

  controlsHTML() {
    return `<section class="control-section detector-panel" aria-label="Детектор частиц">
      <div class="control-heading"><span>Детектор · x = 6</span><output id="detector-status">РАСЧЁТ</output></div>
      <div class="segmented detector-mode" role="group" aria-label="Показания детектора">
        <button data-detector-mode="hits" class="${this.view === 'hits' ? 'active' : ''}">Попадания</button>
        <button data-detector-mode="slice" class="${this.view === 'slice' ? 'active' : ''}">Сечение |ψ|²</button>
      </div>
      <div class="detector-actions">
        <button data-detector-shots="1" disabled>По одной</button>
        <button data-detector-shots="100" disabled>+100</button>
        <button data-detector-shots="1000" disabled>+1000</button>
      </div>
      <p id="detector-counts" class="detector-counts" aria-live="polite">Расчёт волны до t = 10…</p>
      <p id="detector-detail" class="detector-detail">Каждый запуск регистрирует максимум одну частицу.</p>
      <button id="detector-reset" class="detector-reset" disabled>Новая серия ↺</button>
    </section>`;
  }

  reset() {
    this.series = new DetectorSeries({ seed: 20261017 + ++this.sequence });
    this.ready = false;
    this.update();
    this.updatePoints();
  }

  bind({ onChange, notify }) {
    document.querySelectorAll('[data-detector-mode]').forEach(button => {
      button.addEventListener('click', () => {
        this.view = button.dataset.detectorMode;
        this.update();
        onChange();
      });
    });
    document.querySelectorAll('[data-detector-shots]').forEach(button => {
      button.addEventListener('click', () => {
        if (!this.ready) return;
        const added = this.series.run(Number(button.dataset.detectorShots));
        this.updatePoints();
        this.update();
        onChange();
        if (Number(button.dataset.detectorShots) === 1) {
          notify(added.length ? `Регистрация y = ${added[0].toFixed(2)}` : 'Нет регистрации в этом запуске');
        }
      });
    });
    document.querySelector('#detector-reset')?.addEventListener('click', () => {
      this.series.reset();
      this.updatePoints();
      this.update();
      onChange();
    });
    this.update();
  }

  onFrame(frame) {
    if (!this.ready && frame.time >= 10 - 1e-7 && frame.detectorProfile) {
      this.series.setPrediction(frame.detectorProfile, frame.dx, -frame.length / 2);
      this.ready = true;
    }
    this.time = frame.time;
    this.stats = frame.stats;
    this.update();
  }

  update() {
    const status = document.querySelector('#detector-status');
    if (!status) return;
    status.textContent = this.ready ? 'ГОТОВ' : 'РАСЧЁТ';
    status.classList.toggle('ready', this.ready);
    const { shots, clicks, misses } = this.series;
    document.querySelector('#detector-counts').textContent = this.ready
      ? `Запуски ${shots} · Клики ${clicks} · Нет ${misses}`
      : `Расчёт до t = 10 · сейчас t = ${(this.time || 0).toFixed(2)}`;
    document.querySelector('#detector-detail').textContent = this.ready
      ? `P(регистрация) = ${(this.series.probability * 100).toFixed(2)}% · сохранение вероятности = ${(this.stats?.accounted || 0).toFixed(5)}`
      : 'Сначала рассчитывается волна и вероятность первого попадания по y.';
    document.querySelectorAll('[data-detector-shots]').forEach(button => { button.disabled = !this.ready; });
    document.querySelector('#detector-reset').disabled = !this.ready;
    document.querySelectorAll('[data-detector-mode]').forEach(button => {
      const selected = button.dataset.detectorMode === this.view;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  chartMetadata() {
    return this.view === 'hits'
      ? {
          title: 'Накопление регистраций', symbol: 'P / Δy',
          caption: 'Бирюзовая линия — вероятность регистрации до t = 10. Янтарные столбцы — число кликов на один запуск / Δy. Запуски без регистрации тоже учитываются.',
          aria: 'Распределение первых попаданий и гистограмма экспериментальных регистраций',
        }
      : {
          title: 'Сечение x = 6', symbol: '|ψ(6,y)|²',
          caption: 'Мгновенная плотность оставшейся волны, не накопленные попадания.',
          aria: 'Мгновенная плотность вероятности на сечении x равно 6',
        };
  }

  mount3D(world, THREE, scale) {
    this.scale = scale;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2000 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    this.points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xe8b87d, size: 4.5, sizeAttenuation: false,
      depthTest: false, transparent: true, opacity: .92,
    }));
    this.points.frustumCulled = false;
    world.add(this.points);
    this.updatePoints();
  }

  updatePoints() {
    if (!this.points) return;
    const attribute = this.points.geometry.attributes.position;
    for (let i = 0; i < this.series.hits.length; i++) {
      attribute.setXYZ(i, 6 * this.scale, -1.72, -this.series.hits[i] * this.scale);
    }
    this.points.geometry.setDrawRange(0, this.series.hits.length);
    attribute.needsUpdate = true;
  }

  draw(ctx, w, h) {
    const { expected, measured } = this.series.distributions();
    const { bins, minY, maxY } = this.series;
    const left = 27, right = 7, top = 10, bottom = 25;
    const pw = w - left - right, ph = h - top - bottom;
    const ymax = Math.max(.0001, ...expected, ...measured) * 1.12;
    const X = i => left + (i + .5) * pw / bins;
    const Y = v => top + ph * (1 - v / ymax);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '8px "IBM Plex Mono",monospace';
    for (let i = 0; i <= 2; i++) {
      const v = ymax * i / 2;
      ctx.strokeStyle = '#23333f';
      ctx.beginPath(); ctx.moveTo(left, Y(v)); ctx.lineTo(w - right, Y(v)); ctx.stroke();
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#72919f';
      ctx.fillText(v.toFixed(3), left - 5, Y(v));
    }
    if (this.series.shots) {
      ctx.fillStyle = '#e8b87daa';
      const bw = pw / bins;
      for (let i = 0; i < measured.length; i++) {
        const y = Y(measured[i]);
        ctx.fillRect(left + i * bw + .6, y, Math.max(.4, bw - 1.2), top + ph - y);
      }
    }
    ctx.beginPath();
    expected.forEach((v, i) => i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)));
    ctx.strokeStyle = '#72ded8'; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = '#7899a7'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    [[0, minY], [.5, (minY + maxY) / 2], [1, maxY]].forEach(([f, v]) => {
      ctx.fillText(String(v).replace('-', '−'), left + f * pw, top + ph + 7);
    });
    ctx.textAlign = 'right'; ctx.fillText('y', w - right, 0);
  }
}

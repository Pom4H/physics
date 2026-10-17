import { Spinor1D } from './physics/spinor.mjs';
import { SpinorView, COMPONENT_COLORS } from './spinor-view.mjs';

const MODEL = {
  pauli: { label: 'Паули', color: '#e8b87d' },
  dirac: { label: 'Дирак', color: '#72ded8' },
  weyl: { label: 'Вейль', color: '#cc91b4' },
};
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt = (v, d = 2) => (Math.abs(v) < .5 * 10 ** -d ? 0 : v).toFixed(d).replace('-', '−');
const pct = v => `${fmt(100 * v, 1)} %`;
const section = (title, body, wide = false) => `<section class="control-section${wide ? ' wide' : ''}"><div class="control-heading"><span>${title}</span></div>${body}</section>`;
function slider(key, title, value, min, max, step, unit = '', digits = 1) {
  return `<section class="control-section"><div class="control-heading"><label for="spin-${key}">${title}</label><output id="spin-${key}-value" for="spin-${key}">${fmt(value, digits)}${unit}</output></div><input id="spin-${key}" data-spin-param="${key}" data-digits="${digits}" data-unit="${unit}" type="range" min="${min}" max="${max}" step="${step}" value="${value}"><div class="range-labels"><span>${min}${unit}</span><span>${max}${unit}</span></div></section>`;
}

/** UI controller. The x coordinate is physical; separate z lanes only compare models. */
export class SpinorLab {
  constructor() {
    this.params = { mode: 'compare', mass: 1, k0: 1.6, sigma: 2.4, chirality: 1, omega: .9, theta: 90, phi: 0, view: 'density', showSpin: true };
    this.entries = [];
    this.focus = 'dirac';
    this.time = 0;
    this.limit = 20;
    this.view = null;
    this.details = null;
  }

  reset() {
    const p = this.params;
    const ids = p.mode === 'compare' ? (p.mass > 0 ? ['pauli', 'dirac', 'weyl'] : ['dirac', 'weyl']) : [p.mode];
    this.time = 0;
    this.entries = ids.map(id => {
      const params = { model: id, n: 512, length: 96, x0: -12, sigma: p.sigma, k0: p.k0, mass: p.mass, helicity: p.chirality, chirality: p.chirality, c: 1, hbar: 1 };
      if (id === 'pauli' && p.mode === 'pauli') Object.assign(params, { theta: p.theta * Math.PI / 180, phi: p.phi * Math.PI / 180, omega: p.omega });
      return { id, ...MODEL[id], model: new Spinor1D(params) };
    });
    if (!ids.includes(this.focus)) this.focus = ids.includes('dirac') ? 'dirac' : ids[0];
    // End while the visible packet is still within the central, non-wrapping window.
    // The Gaussian bound is intentionally conservative; the actual FFT box is wider.
    this.limit = 20;
    if (ids.includes('pauli')) {
      let lo = 0, hi = 20;
      for (let j = 0; j < 35; j++) {
        const t = (lo + hi) / 2;
        const extent = -12 + p.k0 * t / p.mass + 4.5 * Math.hypot(p.sigma, t / (2 * p.mass * p.sigma));
        if (extent > 27) hi = t; else lo = t;
      }
      this.limit = lo;
    }
    if (this.details) this.renderDetails(this.details);
    return this;
  }

  buildView(parent) {
    this.view = new SpinorView(parent, this.entries, { view: this.params.view, showSpin: this.params.showSpin, xMin: -28, xMax: 28 });
    this.view.update();
  }

  advance(dt) {
    this.time = Math.min(this.limit, this.time + dt);
    for (const entry of this.entries) entry.model.setTime(this.time);
    this.view?.update();
  }

  controlsHTML() {
    const p = this.params;
    let html = section('Уравнение', `<div class="spin-models" role="group" aria-label="Выбор спинорного уравнения">${[['compare', 'Сравнить', '3 модели'], ['pauli', 'Паули', '2 компоненты'], ['dirac', 'Дирак', '4 компоненты'], ['weyl', 'Вейль', '2 компоненты']].map(([id, label, detail]) => `<button data-spin-mode="${id}" class="${p.mode === id ? 'active' : ''}" aria-pressed="${p.mode === id}" ${id === 'pauli' && p.mass === 0 ? 'disabled title="Для Паули нужна ненулевая масса"' : ''}><span>${label}</span><small>${id === 'compare' && p.mass === 0 ? '2 модели' : detail}</small></button>`).join('')}</div>`, true);
    if (p.mode === 'compare' || p.mode === 'dirac') {
      html += section('Режим движения', `<div class="spin-presets" role="group" aria-label="Готовые параметры"><button data-spin-preset="slow" title="m = 4, p₀ = 0.8, σ = 3">v ≪ c</button><button data-spin-preset="fast" title="m = 1, p₀ = 1.6, σ = 2.4">p ≈ mc</button><button data-spin-preset="massless" title="m = 0: Дирак → Вейль">m = 0</button></div>`, true);
    }
    if (p.mode !== 'weyl') html += slider('mass', 'Масса m', p.mass, p.mode === 'pauli' ? .1 : 0, 4, .1);
    html += slider('k0', 'Импульс p₀', p.k0, .8, 3, .1);
    html += slider('sigma', 'Масштаб пакета σ', p.sigma, 2, 4, .1);
    if (p.mode === 'pauli') {
      html += slider('omega', 'Прецессия Ω', p.omega, 0, 2, .1);
      html += slider('theta', 'Начальный угол θ', p.theta, 0, 180, 5, '°', 0);
      html += slider('phi', 'Начальная фаза φ', p.phi, -180, 180, 5, '°', 0);
    } else {
      const title = p.mode === 'dirac' ? 'Спиральность h' : 'Хиральность Вейля';
      const rightLabel = p.mode === 'dirac' ? 'h = +1' : 'Правая R';
      const leftLabel = p.mode === 'dirac' ? 'h = −1' : 'Левая L';
      html += section(title, `<div class="segmented" role="group" aria-label="${title}"><button data-spin-chirality="1" class="${p.chirality === 1 ? 'active' : ''}" aria-pressed="${p.chirality === 1}">${rightLabel}</button><button data-spin-chirality="-1" class="${p.chirality === -1 ? 'active' : ''}" aria-pressed="${p.chirality === -1}">${leftLabel}</button></div><p class="control-note">p &gt; 0. Спин ${p.chirality === 1 ? 'вдоль' : 'против'} импульса. Обе хиральности Вейля движутся вправо.</p>`, true);
    }
    html += section('Представление', `<div class="segmented" role="group" aria-label="Представление спинора"><button data-spin-view="density" class="${p.view === 'density' ? 'active' : ''}" aria-pressed="${p.view === 'density'}">Плотность ρ</button><button data-spin-view="components" class="${p.view === 'components' ? 'active' : ''}" aria-pressed="${p.view === 'components'}">Компоненты</button></div><label class="switch-row"><span>Стрелки спина</span><input id="spin-arrows" type="checkbox" ${p.showSpin ? 'checked' : ''}></label><p class="control-note">Одна координата x; стрелки показывают трёхмерную поляризацию. Δp ≈ 1/(2σ).</p>`, true);
    const rms = Math.hypot(p.k0, 1 / (2 * p.sigma));
    let notice;
    if (p.mode === 'weyl') notice = 'm = 0 · E > 0. Пакет движется со скоростью c без расплывания в этой одномерной модели.';
    else if (p.mass === 0) notice = 'm = 0: Дирак совпадает с выбранным Вейлем. Уравнение Паули при нулевой массе неприменимо.';
    else if (p.mode === 'pauli') notice = 'H = p²/(2m) + Ωσz/2. Однородная спиновая связь вращает поляризацию; орбитальное действие магнитного поля не включено.';
    else notice = 'Одинаковый спектр при p > 0; Дирак и Вейль — только E > 0. Начальные плотности в x могут немного различаться.';
    html += `<div class="spin-notice control-section wide">${notice}${p.mass > 0 && p.mode !== 'weyl' ? `<span>pᵣₘₛ/(mc) ≈ ${fmt(rms / p.mass)}${rms / p.mass > .3 ? ' · нерелятивистское приближение Паули теряет точность; его скорость может превысить c.' : ' · нерелятивистский режим.'}</span>` : ''}</div>`;
    return html;
  }

  bindControls(container, { reset, view, legend = () => {} }) {
    const p = this.params;
    container.querySelectorAll('[data-spin-param]').forEach(input => {
      input.addEventListener('input', () => {
        container.querySelector(`#${input.id}-value`).textContent = `${fmt(+input.value, +input.dataset.digits)}${input.dataset.unit}`;
      });
      input.addEventListener('change', () => { p[input.dataset.spinParam] = +input.value; reset(); });
    });
    container.querySelectorAll('[data-spin-mode]').forEach(button => button.addEventListener('click', () => { p.mode = button.dataset.spinMode; reset(); }));
    container.querySelectorAll('[data-spin-preset]').forEach(button => button.addEventListener('click', () => {
      const preset = button.dataset.spinPreset;
      Object.assign(p, preset === 'slow' ? { mass: 4, k0: .8, sigma: 3 } : preset === 'fast' ? { mass: 1, k0: 1.6, sigma: 2.4 } : { mass: 0, k0: 1.6, sigma: 2.4 });
      reset();
    }));
    container.querySelectorAll('[data-spin-chirality]').forEach(button => button.addEventListener('click', () => { p.chirality = +button.dataset.spinChirality; reset(); }));
    container.querySelectorAll('[data-spin-view]').forEach(button => button.addEventListener('click', () => { p.view = button.dataset.spinView; view(); }));
    container.querySelector('#spin-arrows').addEventListener('change', event => { p.showSpin = event.target.checked; this.view?.setSpinVisible(p.showSpin); legend(); });
  }

  metadata() {
    const p = this.params;
    return {
      title: { compare: 'Волна со спином', pauli: 'Спин в движении', dirac: 'Масса связывает', weyl: 'Хиральная волна' }[p.mode],
      subtitle: { compare: p.mass === 0 ? 'Безмассовый Дирак совпадает с выбранным Вейлем.' : 'Один спектр импульса. Три уравнения движения.', pauli: 'Две комплексные компоненты и прецессия спина.', dirac: 'Четыре компоненты: левая и правая хиральности.', weyl: 'Двухкомпонентное безмассовое состояние.' }[p.mode],
      badge: p.mode === 'compare' ? '1D · СРАВНЕНИЕ' : p.mode === 'dirac' ? '4 КОМПОНЕНТЫ' : '2 КОМПОНЕНТЫ',
      method: 'Спектральная эволюция · 512 узлов · ℏ = c = 1',
      note: p.mode === 'compare' ? 'Дорожки разделяют независимые модели. Высота — ρ = Ψ†Ψ в едином масштабе. Стрелки — локальный спин. Совпадение Дирака и Вейля при m = 0 видно и на общем графике.' : p.mode === 'pauli' ? '↑ и ↓ — проекции на z. Изменение относительной фазы вращает спин; в однородной спиновой связи пространственная плотность не зависит от Ω.' : p.mode === 'dirac' ? 'Масса связывает χL и χR в уравнении. Для подготовленного свободного пакета с положительной энергией их суммарные доли сохраняются во времени.' : 'В одной хиральности остаются две комплексные спиновые компоненты. При выбранных p > 0, E > 0 правая хиральность имеет спин вдоль x, левая — против x.',
    };
  }

  legendHTML() {
    let html = `<span class="legend-title">${this.params.view === 'density' ? `Высота — ρ${this.params.showSpin ? ' · стрелки — локальная поляризация' : ''}` : 'Кривые — |Ψⱼ|² · глубина разделяет компоненты'}</span>`;
    if (this.params.view === 'components') html += '<span class="legend-item"><i style="background:#72ded8"></i>↑ / L↑</span><span class="legend-item"><i style="background:#e8b87d"></i>↓ / L↓</span>' + (this.entries.some(e => e.id === 'dirac') ? '<span class="legend-item"><i style="background:#8daee7"></i>R↑</span><span class="legend-item"><i style="background:#cc91b4"></i>R↓</span>' : '');
    else html += this.entries.map(e => `<span class="legend-item"><i style="background:${e.color}"></i>${e.label}</span>`).join('');
    return html;
  }

  statsRows() {
    const stats = this.entries.map(e => [e, e.model.stats()]);
    if (this.params.mode === 'compare') {
      const rows = stats.map(([e, s]) => [`⟨v⟩ / c · ${e.label}`, fmt(s.meanVelocity, 3), e.id === 'dirac']);
      rows.push(['Общий ⟨p⟩', fmt(stats[0][1].meanMomentum, 3)]);
      const error = Math.max(...stats.map(([, s]) => Math.abs(s.norm - 1)));
      rows.push(['Макс. |∫ρ dx − 1|', error.toExponential(1)]);
      return rows;
    }
    const s = stats[0][1];
    return [['Скорость ⟨v⟩ / c', fmt(s.meanVelocity, 3), true], ['Положение ⟨x⟩', fmt(s.xMean, 3)], ['Ширина σₓ', fmt(s.sigmaX, 3)], ['Нормировка ∫ρ dx', fmt(s.norm, 6)]];
  }

  renderDetails(container) {
    this.details = container;
    if (!this.entries.length) return;
    const entry = this.entries.find(e => e.id === this.focus) || this.entries[0];
    this.focus = entry.id;
    container.innerHTML = `<div class="section-label"><span>СОСТАВ СПИНОРА</span><span>↑ / ↓ ПО ОСИ z</span></div>${this.entries.length > 1 ? `<label class="spin-focus">Модель<select id="spin-focus-model" aria-label="Модель для анализа компонент">${this.entries.map(e => `<option value="${e.id}" ${e.id === this.focus ? 'selected' : ''}>${e.label}</option>`).join('')}</select></label>` : `<div class="spin-focus"><span>${entry.label}</span><span>${entry.model.components.length} комплексные компоненты</span></div>`}<div class="spin-vector"><span>⟨Σ⟩</span><div><small>x</small><strong id="spin-nx">—</strong></div><div><small>y</small><strong id="spin-ny">—</strong></div><div><small>z</small><strong id="spin-nz">—</strong></div></div>${entry.id !== 'pauli' ? '<div class="chiral-labels"><span>L <b id="spin-left">—</b></span><span>R <b id="spin-right">—</b></span></div><div class="chiral-meter" role="img" id="chiral-meter" aria-label="Доли левой и правой хиральностей"><span id="spin-left-bar"></span><span id="spin-right-bar"></span></div>' : ''}<div class="spin-component-head"><span>Компонента</span><span>Доля</span><span>Δφ / π</span></div>${entry.model.components.map((component, j) => `<div class="spin-component-row"><span><i style="background:${COMPONENT_COLORS[j]}"></i>${component.label}</span><strong id="spin-weight-${j}">—</strong><strong id="spin-phase-${j}">—</strong></div>`).join('')}<p class="control-note spin-phase-note" id="spin-phase-note"></p><p class="control-note">⟨Σ⟩ — средняя поляризация; ⟨S⟩ = ℏ⟨Σ⟩/2. Доли компонент интегрированы по x.</p>`;
    container.querySelector('#spin-focus-model')?.addEventListener('change', event => { this.focus = event.target.value; this.renderDetails(container); });
    this.updateDetails();
  }

  updateDetails() {
    if (!this.details || !this.entries.length) return;
    const root = this.details;
    const entry = this.entries.find(e => e.id === this.focus) || this.entries[0];
    const m = entry.model, s = m.stats();
    for (const [id, value] of [['nx', s.spinX], ['ny', s.spinY], ['nz', s.spinZ]]) root.querySelector(`#spin-${id}`).textContent = fmt(value, 2);
    if (entry.id !== 'pauli') {
      root.querySelector('#spin-left').textContent = pct(s.leftWeight);
      root.querySelector('#spin-right').textContent = pct(s.rightWeight);
      root.querySelector('#spin-left-bar').style.width = `${clamp(s.leftWeight, 0, 1) * 100}%`;
      root.querySelector('#spin-right-bar').style.width = `${clamp(s.rightWeight, 0, 1) * 100}%`;
      root.querySelector('#chiral-meter').setAttribute('aria-label', `Левая хиральность ${pct(s.leftWeight)}, правая ${pct(s.rightWeight)}`);
    }
    let peak = 0;
    for (let i = 1; i < m.n; i++) if (m.density[i] > m.density[peak]) peak = i;
    const reference = m.components.findIndex(c => c.re[peak] ** 2 + c.im[peak] ** 2 > m.density[peak] * 1e-8);
    const rc = m.components[reference];
    const phase0 = rc ? Math.atan2(rc.im[peak], rc.re[peak]) : 0;
    m.components.forEach((c, j) => {
      let weight = 0;
      for (let i = 0; i < m.n; i++) weight += c.re[i] ** 2 + c.im[i] ** 2;
      root.querySelector(`#spin-weight-${j}`).textContent = pct(weight * m.dx / s.norm);
      const amplitude2 = c.re[peak] ** 2 + c.im[peak] ** 2;
      let phase = Math.atan2(c.im[peak], c.re[peak]) - phase0;
      phase = Math.atan2(Math.sin(phase), Math.cos(phase));
      root.querySelector(`#spin-phase-${j}`).textContent = amplitude2 > m.density[peak] * 1e-8 ? fmt(phase / Math.PI, 2) : '—';
    });
    root.querySelector('#spin-phase-note').textContent = `Δφ — фаза в максимуме ρ, x ≈ ${fmt((peak - m.n / 2) * m.dx, 1)}, относительно ${rc?.label || '—'}. Общая фаза исключена; «—» означает пренебрежимо малую амплитуду.`;
  }

  drawChart(context, w, h) {
    const pad = { l: 30, r: 9, t: 10, b: 23 };
    const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
    const maxY = 1.25 / (Math.sqrt(TAU) * this.params.sigma);
    const X = x => pad.l + (x + 28) / 56 * pw;
    const Y = y => pad.t + ph - y / maxY * ph;
    context.clearRect(0, 0, w, h);
    context.font = '8px "IBM Plex Mono",monospace';
    context.textAlign = 'right'; context.textBaseline = 'middle'; context.lineWidth = 1;
    for (let j = 0; j <= 2; j++) {
      const v = j * maxY / 2;
      context.strokeStyle = '#23333f'; context.beginPath(); context.moveTo(pad.l, Y(v)); context.lineTo(w - pad.r, Y(v)); context.stroke();
      context.fillStyle = '#668591'; context.fillText(j ? fmt(v, 2) : '0', pad.l - 5, Y(v));
    }
    context.save(); context.beginPath(); context.rect(pad.l, pad.t, pw, ph + 1); context.clip();
    this.entries.forEach(entry => {
      const m = entry.model;
      context.beginPath(); let first = true;
      for (let i = 0; i < m.n; i++) {
        const x = (i - m.n / 2) * m.dx;
        if (x < -28 || x > 28) continue;
        if (first) { context.moveTo(X(x), Y(m.density[i])); first = false; } else context.lineTo(X(x), Y(m.density[i]));
      }
      context.strokeStyle = entry.color; context.lineWidth = entry.id === 'dirac' ? 2.4 : 1.4;
      context.setLineDash(entry.id === 'weyl' && this.entries.length > 1 ? [4, 3] : []);
      context.stroke();
    });
    context.restore(); context.setLineDash([]);
    context.fillStyle = '#7593a1'; context.textAlign = 'center'; context.textBaseline = 'top';
    for (const x of [-28, 0, 28]) context.fillText(String(x).replace('-', '−'), X(x), pad.t + ph + 7);
    context.textAlign = 'right'; context.fillText('x', w - pad.r, 0);
  }
}

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { ORBITALS, sampleOrbital, radialProbability } from './physics/atom.mjs';
import { Quantum1D } from './physics/wave.mjs';
import { SpinorLab } from './spinor-lab.mjs';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const CYAN = new THREE.Color('#72ded8');
const AMBER = new THREE.Color('#e8b87d');
const BLUE = new THREE.Color('#8daee7');
const PINK = new THREE.Color('#cc91b4');
const PALE = new THREE.Color('#e8f2df');
const PHASE_STOPS = [CYAN, BLUE, PINK, AMBER, CYAN];
const fmt = (value, digits = 2) => Number(value).toFixed(digits).replace('-', '−');
const percent = (value) => `${fmt(value * 100, 2)} %`;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const orbitalHTML = (id) => ({ '1s': '1s', '2s': '2s', '2pz': '2p<sub>z</sub>', '2px': '2p<sub>x</sub>', '3dz2': '3d<sub>z²</sub>', '3dxz': '3d<sub>xz</sub>', '3dxy': '3d<sub>xy</sub>' })[id];
const mobile = matchMedia('(max-width:680px)');
const reducedMotion = matchMedia('(prefers-reduced-motion:reduce)').matches;
const spinorLab = new SpinorLab();
const scalarEquationHTML = $('.top-equation').innerHTML;
const settings = {
  spinor: spinorLab.params,
  atom: { orbital: '3dxz', view: 'phase', slice: false, count: mobile.matches ? 34000 : 64000 },
  free: { sigma: 1.6, k0: 3, view: 'wave' },
  barrier: { sigma: 2, k0: 3, barrierHeight: 8, barrierWidth: 0.75, view: 'density' },
  oscillator: { omega: 0.32, x0: -8, view: 'density' },
  well: { wellWidth: 12, wellMix: 0.5, n1: 1, n2: 2, view: 'density' },
  slits: { slitSeparation: 5, slitWidth: 1.8, k0: 2.5, n: 128, view: 'phase', top: false },
};
const SCENES = {
  spinor: { index: '07', kicker: 'ПАУЛИ · ДИРАК · ВЕЙЛЬ' },
  atom: { index: '01', kicker: 'СВЯЗАННОЕ СОСТОЯНИЕ', title: 'Форма вероятности', subtitle: 'Электрон в атоме водорода.', badge: 'АНАЛИТИКА', method: 'Точное решение · атомные единицы', note: 'Точки — выборки из |ψ|² одного электрона. Цвет показывает относительную фазу. Движется только камера.' },
  free: { index: '02', kicker: 'СВОБОДНАЯ ЧАСТИЦА', title: 'Волна в движении', subtitle: 'Пакет движется и постепенно расплывается.', badge: '1D · FFT', method: 'Расщепление оператора · 1024 узла · ℏ = m = 1', note: 'В режиме ψ две поперечные оси — Re ψ и Im ψ. В режиме |ψ|² высота показывает плотность вероятности. Пространственная ось одна: x.' },
  barrier: { index: '03', kicker: 'ПОТЕНЦИАЛЬНЫЙ БАРЬЕР', title: 'По другую сторону', subtitle: 'Часть волны проходит даже при энергии ниже барьера.', badge: '1D · FFT', method: 'Расщепление оператора · 1024 узла · ℏ = m = 1', note: 'Слева сначала находится падающий пакет. После столкновения остаются отражённая и прошедшая части. Высота изображения барьера условная.' },
  slits: { index: '04', kicker: 'ДВУМЕРНОЕ РАССЕЯНИЕ', title: 'Две щели', subtitle: 'Дифракция у щелей создаёт интерференционную картину.', badge: '2D · FFT', method: 'Двумерное уравнение · 128² узлов · ℏ = m = 1', note: 'Поверхность — плотность |ψ(x,y)|², а не траектория. Цвет фазы помогает читать волны. Сечение справа — мгновенная плотность при x = 6.' },
  oscillator: { index: '05', kicker: 'ГАРМОНИЧЕСКИЙ ПОТЕНЦИАЛ', title: 'Квантовый ритм', subtitle: 'Когерентный пакет колеблется, сохраняя ширину.', badge: '1D · FFT', method: 'Расщепление оператора · 1024 узла · ℏ = m = 1', note: 'Пакет начинается в когерентном состоянии: σ = 1/√(2ω). Его центр следует гармонической траектории. Потенциал показан в условном масштабе.' },
  well: { index: '06', kicker: 'БЕСКОНЕЧНАЯ ПОТЕНЦИАЛЬНАЯ ЯМА', title: 'Между стенками', subtitle: 'Два уровня энергии образуют меняющуюся суперпозицию.', badge: 'АНАЛИТИКА', method: 'Точная суперпозиция собственных функций · ℏ = m = 1', note: 'Плотность одного уровня стационарна. В суперпозиции относительная фаза меняется, и вероятность перетекает между областями ямы.' },
};

let currentScene = 'atom';
let running = !reducedMotion;
let speed = 1;
let solver = null;
let worker = null;
let workerBusy = false;
let workerVersion = 0;
let sim2 = null;
let simStats = {};
let accumulator = 0;
let chartDirty = true;
let visual = {};
let currentCameraKind = '';
let toastTimer;
let renderer;
let controls;
let scene;
let camera;
let world;
let lastFrame = performance.now();
let lastStats = 0;
let fpsSince = performance.now();
let frameCount = 0;

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2600);
}

function section(title, body, wide = false) {
  return `<section class="control-section${wide ? ' wide' : ''}"><div class="control-heading"><span>${title}</span></div>${body}</section>`;
}
function range(id, title, value, min, max, step, unit = '', digits = 1) {
  return `<section class="control-section"><div class="control-heading"><label for="${id}">${title}</label><output for="${id}" id="${id}-value">${fmt(value, digits)}${unit}</output></div><input id="${id}" type="range" value="${value}" min="${min}" max="${max}" step="${step}" data-unit="${unit}" data-digits="${digits}"><div class="range-labels"><span>${min}${unit}</span><span>${max}${unit}</span></div></section>`;
}
function segments(name, values, selected) {
  const accessibleName = { view: 'Представление волны', level: 'Второй уровень энергии', quality: 'Разрешение сетки' }[name] || name;
  return `<div class="segmented" role="group" aria-label="${accessibleName}">${values.map(([value, label]) => `<button data-${name}="${value}" class="${value === selected ? 'active' : ''}" aria-pressed="${value === selected}">${label.replace('Плотность |ψ|²', 'Плотность')}</button>`).join('')}</div>`;
}
function setStats(rows) {
  $('#stats').innerHTML = rows.map(([label, value, accent]) => `<div class="stat"><span>${label}</span><strong${accent ? ' class="accent"' : ''}>${value}</strong></div>`).join('');
}

function buildControls() {
  if (currentScene === 'spinor') {
    $('#controls').innerHTML = spinorLab.controlsHTML();
    spinorLab.bindControls($('#controls'), {
      reset: () => {
        const previousModels = spinorLab.entries.map(e => e.id).join(',');
        startScene(false); buildControls(); syncSceneHash();
        if (previousModels !== spinorLab.entries.map(e => e.id).join(',')) resetCamera(true);
      },
      legend: () => { updateLegend(); resetCamera(true); },
      view: () => { buildControls(); clearWorld(); spinorLab.buildView(world); updateLegend(); resetCamera(true); chartDirty = true; },
    });
    return;
  }
  const p = settings[currentScene];
  let html = '';
  if (currentScene === 'atom') {
    html += section('Орбиталь', `<div class="orbital-grid">${ORBITALS.map(o => `<button class="orbital-button ${o.id === p.orbital ? 'active' : ''}" data-orbital="${o.id}" aria-pressed="${o.id === p.orbital}" aria-label="Орбиталь ${o.label}">${orbitalHTML(o.id)}</button>`).join('')}</div>`);
    html += section('Что показывать', segments('view', [['phase', 'Фаза ψ'], ['density', 'Плотность |ψ|²']], p.view) + `<label class="switch-row"><span>Открыть срез xz</span><input id="slice" type="checkbox" ${p.slice ? 'checked' : ''}></label><p class="control-note">Фаза 0 / π разделяет области разных знаков волновой функции.</p>`);
  } else if (currentScene === 'free') {
    html += range('sigma', 'Ширина пакета σ', p.sigma, 0.8, 3.5, 0.1);
    html += range('k0', 'Импульс k₀', p.k0, 0.5, 4.5, 0.1);
    html += section('Представление', segments('view', [['density', 'Плотность |ψ|²'], ['wave', 'Волна ψ']], p.view));
  } else if (currentScene === 'barrier') {
    html += range('barrierHeight', 'Высота барьера V₀', p.barrierHeight, 2, 14, 0.5);
    html += range('barrierWidth', 'Ширина барьера a', p.barrierWidth, 0.25, 2, 0.125, '', 3);
    html += range('k0', 'Импульс k₀', p.k0, 1.5, 4.5, 0.1);
    html += section('Представление', segments('view', [['density', 'Плотность |ψ|²'], ['wave', 'Волна ψ']], p.view));
  } else if (currentScene === 'oscillator') {
    html += range('omega', 'Частота ω', p.omega, 0.15, 0.65, 0.01, '', 2);
    html += range('x0', 'Начальное положение', p.x0, -10, 10, 0.5);
    html += section('Представление', segments('view', [['density', 'Плотность |ψ|²'], ['wave', 'Волна ψ']], p.view));
  } else if (currentScene === 'well') {
    html += range('wellMix', 'Доля второго уровня', p.wellMix * 100, 0, 100, 5, ' %', 0);
    html += range('wellWidth', 'Ширина ямы L', p.wellWidth, 8, 18, 0.5);
    html += section('Второй уровень', segments('level', [['2', 'n = 2'], ['3', 'n = 3'], ['4', 'n = 4']], String(p.n2)));
    html += section('Представление', segments('view', [['density', 'Плотность |ψ|²'], ['wave', 'Волна ψ']], p.view));
  } else {
    html += range('slitSeparation', 'Расстояние между щелями', p.slitSeparation, 3.5, 8, 0.25, '', 2);
    html += range('slitWidth', 'Ширина щелей', p.slitWidth, 0.8, 2.5, 0.1);
    html += section('Представление', segments('view', [['density', 'Плотность |ψ|²'], ['phase', 'Фаза ψ']], p.view) + `<label class="switch-row"><span>Вид сверху</span><input id="top-view" type="checkbox" ${p.top ? 'checked' : ''}></label>`);
    html += section('Точность сетки', segments('quality', [['128', '128²'], ['256', '256²']], String(p.n)) + '<p class="control-note">256² уточняет края щелей. Расчёт может идти медленнее.</p>');
  }
  $('#controls').innerHTML = html;
  $$('#controls input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      $(`#${input.id}-value`).textContent = `${fmt(input.value, +input.dataset.digits)}${input.dataset.unit}`;
    });
    input.addEventListener('change', () => {
      p[input.id] = input.id === 'wellMix' ? +input.value / 100 : +input.value;
      startScene(false);
    });
  });
  $$('[data-orbital]').forEach(button => button.addEventListener('click', () => {
    p.orbital = button.dataset.orbital;
    buildControls();
    buildAtom();
    updateMetadata();
    updateStats();
    chartDirty = true;
  }));
  $$('[data-view]').forEach(button => button.addEventListener('click', () => {
    p.view = button.dataset.view;
    buildControls();
    updateLegend();
    if (currentScene === 'atom') { visual.points.material.uniforms.uPhase.value = p.view === 'phase' ? 1 : 0; }
    else if (currentScene === 'slits') { update2DVisual(); }
    else { buildWave(); updateWaveVisual(); }
  }));
  $('#slice')?.addEventListener('change', event => {
    p.slice = event.target.checked;
    visual.points.material.uniforms.uClip.value = p.slice ? 1 : 0;
    if (visual.slice) visual.slice.visible = p.slice;
    updateLegend();
  });
  $('#top-view')?.addEventListener('change', event => {
    p.top = event.target.checked;
    resetCamera(true);
  });
  $$('[data-quality]').forEach(button => button.addEventListener('click', () => {
    p.n = +button.dataset.quality;
    buildControls();
    startScene(false);
    updateMetadata();
  }));
  $$('[data-level]').forEach(button => button.addEventListener('click', () => {
    p.n2 = +button.dataset.level;
    buildControls();
    startScene(false);
  }));
}

function updateMetadata() {
  const meta = currentScene === 'spinor' ? { ...SCENES.spinor, ...spinorLab.metadata() } : SCENES[currentScene];
  $('#spinor-details').hidden = currentScene !== 'spinor';
  $('#chart-key').hidden = currentScene !== 'spinor';
  $('#inspector').classList.toggle('spinor-inspector', currentScene === 'spinor');
  $('.main').classList.toggle('spinor-active', currentScene === 'spinor');
  document.body.classList.toggle('spinor-page', currentScene === 'spinor');
  $('.top-equation').innerHTML = currentScene === 'spinor' ? 'iℏ ∂Ψ / ∂t = H Ψ' : scalarEquationHTML;
  $('.top-equation').setAttribute('aria-label', currentScene === 'spinor' ? 'Уравнение эволюции спинора' : 'Уравнение Шрёдингера');
  $('.born-rule').textContent = currentScene === 'spinor' ? 'ρ = Ψ†Ψ' : 'ρ = |ψ|²';
  $('#scene-kicker').textContent = `${meta.index} / ${meta.kicker}`;
  $('#scene-title').textContent = meta.title;
  $('#scene-subtitle').textContent = meta.subtitle;
  $('#model-badge').textContent = meta.badge;
  $('#method-status').textContent = currentScene === 'slits' ? `Двумерное уравнение · ${settings.slits.n}² узлов · ℏ = m = 1` : meta.method;
  $('#model-note').textContent = meta.note;
  $('#state-tagline').textContent = currentScene === 'atom' ? 'ЭЛЕКТРОН · H' : 'ВОЛНА МАТЕРИИ · ℏ = m = 1';
  if (currentScene === 'atom') {
    $('#state-symbol').innerHTML = orbitalHTML(settings.atom.orbital);
    $('#chart-title').textContent = 'Радиальная вероятность';
    $('#chart-symbol').textContent = 'r² |R(r)|²';
    $('#chart-caption').textContent = 'Вероятность в сферическом слое радиуса r.';
    $('#chart').setAttribute('aria-label', 'Радиальная плотность вероятности выбранной орбитали');
  } else if (currentScene === 'spinor') {
    const p = spinorLab.params;
    $('#state-symbol').innerHTML = p.mode === 'weyl' ? `χ<sub>${p.chirality === 1 ? 'R' : 'L'}</sub>` : p.mode === 'pauli' ? 'ψ' : 'Ψ';
    $('#state-tagline').textContent = p.mode === 'compare' ? 'ОДИН СПЕКТР · РАЗНЫЕ УРАВНЕНИЯ' : 'СПИН ½ · ℏ = c = 1';
    $('#chart-title').textContent = p.mode === 'compare' ? 'Сравнение плотностей' : 'Плотность вероятности';
    $('#chart-symbol').textContent = 'ρ = Ψ†Ψ';
    $('#chart-caption').textContent = p.mode === 'compare' ? 'Общие оси и фиксированный масштаб. При m = 0 Дирак и Вейль совпадают.' : 'Сумма квадратов модулей всех компонент. Линейный масштаб сохраняется во времени.';
    $('#chart').setAttribute('aria-label', 'Плотности вероятности спинорных моделей на общей пространственной оси x');
    $('#chart-key').innerHTML = spinorLab.entries.map(e => `<span><i style="background:${e.color}"></i>${e.label}</span>`).join('');
  } else if (currentScene === 'slits') {
    $('#state-symbol').innerHTML = 'ψ(x,y)';
    $('#chart-title').textContent = 'Сечение x = 6';
    $('#chart-symbol').textContent = '|ψ(6,y)|²';
    $('#chart-caption').textContent = 'Мгновенная плотность. Профиль появляется, когда волна достигает сечения.';
    $('#chart').setAttribute('aria-label', 'Мгновенная плотность вероятности на сечении x равно 6');
  } else {
    $('#state-symbol').innerHTML = currentScene === 'well' ? `ψ<sub>1</sub> + ψ<sub>${settings.well.n2}</sub>` : 'ψ(x,t)';
    $('#chart-title').textContent = 'Плотность вероятности';
    $('#chart-symbol').textContent = '|ψ(x)|²';
    $('#chart-caption').textContent = currentScene === 'barrier' ? 'Область барьера выделена. Масштаб плотности сохраняется во времени.' : 'Линейная шкала в показанном диапазоне x.';
    $('#chart').setAttribute('aria-label', 'Плотность вероятности вдоль пространственной оси x');
  }
  $('#progress-track').classList.toggle('stationary', currentScene === 'atom');
  updateLegend();
  updatePlay();
  positionStateTag();
}

function positionStateTag() {
  const header = $('.scene-header');
  $('#scene-tag').style.top = `${Math.max(132, header.offsetTop + header.offsetHeight + 15)}px`;
}

function updateLegend() {
  if (currentScene === 'spinor') { $('#legend').innerHTML = spinorLab.legendHTML(); return; }
  const view = settings[currentScene].view;
  let html;
  if (currentScene === 'atom') {
    html = view === 'phase' ? '<span class="legend-title">Относительная фаза ψ</span><span class="legend-item"><i></i>0</span><span class="legend-item"><i class="amber"></i>π</span>' : '<span class="legend-item"><i></i>Плотность точек ∝ |ψ|²</span>';
    if (settings.atom.slice) html += '<span class="legend-item">Срез xz</span>';
  } else if (currentScene === 'slits' && view === 'phase') {
    html = '<span class="legend-title">Высота — |ψ|² · цвет — фаза</span><span class="phase-strip"></span><span>0 … 2π</span><span class="legend-item"><i class="amber"></i>Барьер</span>';
  } else if (view === 'wave') {
    html = '<span class="legend-title">ψ: высота — Re, глубина — Im</span><span class="phase-strip"></span><span>Фаза ψ</span><span class="legend-item"><i class="grey"></i>Огибающая |ψ|</span>';
  } else {
    html = '<span class="legend-item"><i></i>|ψ|²</span>';
    if (['barrier', 'slits', 'oscillator', 'well'].includes(currentScene)) html += '<span class="legend-item"><i class="amber"></i>Потенциал V</span>';
  }
  $('#legend').innerHTML = html;
}

function clearWorld() {
  if (!world) return;
  world.traverse(object => {
    object.geometry?.dispose();
    if (object.material) {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) { material.map?.dispose(); material.dispose(); }
    }
  });
  scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
  visual = {};
}

function line(points, color = '#365665', opacity = 0.45, dashed = false) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p)));
  const material = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: .14, gapSize: .2, depthWrite: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const object = new THREE.Line(geometry, material);
  if (dashed) object.computeLineDistances();
  world.add(object);
  return object;
}

function label(text, position, { size = .42, color = '#789ba9' } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 384; canvas.height = 80;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '28px monospace'; context.fillStyle = color; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(text, 192, 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, opacity: .8 });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(...position); sprite.scale.set(size * 4.8, size, 1);
  world.add(sprite);
  return sprite;
}

function ground(size = 28, y = -7, divisions = 20) {
  const grid = new THREE.GridHelper(size, divisions, '#3f5866', '#223641');
  grid.position.y = y;
  grid.material.transparent = true;
  grid.material.opacity = .13;
  grid.material.depthWrite = false;
  world.add(grid);
}

function makeAtomAxes(scale, extent) {
  const v = extent * scale * .72;
  line([[-v, 0, 0], [v, 0, 0]], '#597987', .35, true);
  line([[0, -v, 0], [0, v, 0]], '#597987', .35, true);
  line([[0, 0, -v], [0, 0, v]], '#597987', .26, true);
  label('x', [v + .55, 0, 0]);
  label('z', [0, v + .4, 0]);
  label('y', [0, 0, -v - .55]);
  const tick = extent >= 20 ? 10 : extent >= 10 ? 5 : 1;
  for (let j = -2; j <= 2; j++) {
    if (!j) continue;
    const x = j * tick * scale;
    if (Math.abs(x) < v) {
      line([[x, -.1, 0], [x, .1, 0]], '#597987', .5);
      label(`${j * tick}`, [x, -.4, 0], { size: .33 });
    }
  }
  label('a₀', [v - .2, -.7, 0], { size: .36 });
}

function buildAtom() {
  clearWorld();
  const p = settings.atom;
  const orbital = ORBITALS.find(o => o.id === p.orbital);
  const sample = sampleOrbital(p.orbital, p.count, 713);
  const scale = 15.6 / orbital.displayExtent;
  const positions = sample.positions;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    positions[i] = x * scale; positions[i + 1] = z * scale; positions[i + 2] = -y * scale;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(sample.phases, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: { uPositive: { value: CYAN }, uNegative: { value: AMBER }, uPhase: { value: p.view === 'phase' ? 1 : 0 }, uClip: { value: p.slice ? 1 : 0 }, uPointSize: { value: renderer.getPixelRatio() * (mobile.matches ? 1.75 : 1.9) }, uOpacity: { value: .47 * (42000 / p.count) ** .6 } },
    vertexShader: `attribute float aPhase; varying float vPhase; varying float vClip; uniform float uPointSize; void main(){vPhase=aPhase;vClip=position.z;vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(uPointSize*30./-mv.z,1.,5.5);}`,
    fragmentShader: `uniform vec3 uPositive; uniform vec3 uNegative; uniform float uPhase; uniform float uClip; uniform float uOpacity; varying float vPhase; varying float vClip; void main(){if(uClip>.5 && vClip>0.)discard;vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;float a=exp(-3.8*r)*uOpacity;vec3 c=mix(uPositive,uNegative,step(1.,vPhase)*uPhase);gl_FragColor=vec4(c*1.7,a);}`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  world.add(points);
  makeAtomAxes(scale, orbital.displayExtent);
  ground(30, -9.1, 20);
  const nucleus = new THREE.Mesh(new THREE.SphereGeometry(.045, 16, 12), new THREE.MeshBasicMaterial({ color: '#e0eae9' }));
  world.add(nucleus);
  const slice = line([[-9, -9, 0], [9, -9, 0], [9, 9, 0], [-9, 9, 0], [-9, -9, 0]], '#73b2b4', .24, true);
  slice.visible = p.slice;
  visual = { points, slice, orbital, sample, scale };
  resetCamera(currentCameraKind !== 'atom');
}

function barrierBox(x, width, length, z = 0, height = 5.2, bottom = -2.4) {
  const geometry = new THREE.BoxGeometry(width, height, length);
  const box = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false }));
  box.position.set(x, bottom + height / 2, z);
  world.add(box);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: '#b39368', transparent: true, opacity: .43, depthWrite: false }));
  edges.position.copy(box.position); world.add(edges);
  return box;
}

function waveLimits() {
  if (currentScene === 'well') return Math.max(10, settings.well.wellWidth / 2 + 2);
  if (currentScene === 'oscillator') return 16;
  return 28;
}

function buildWave() {
  if (!solver) return;
  clearWorld();
  const p = settings[currentScene];
  const extent = waveLimits();
  const xScale = 12 / extent;
  const start = Math.max(0, Math.floor(solver.n / 2 - extent / solver.dx));
  const end = Math.min(solver.n - 1, Math.ceil(solver.n / 2 + extent / solver.dx));
  const count = end - start + 1;
  const baseY = -2.4;
  const densityScale = currentScene === 'well' ? settings.well.wellWidth * 2.5 : currentScene === 'barrier' ? 11 : 26;
  const waveScale = 7;
  const radius = mobile.matches ? .036 : .028;
  const rings = 6;
  const positions = new Float32Array(count * rings * 3);
  const colors = new Float32Array(positions.length);
  const indices = [];
  for (let i = 0; i < count - 1; i++) for (let j = 0; j < rings; j++) {
    const a = i * rings + j, b = i * rings + (j + 1) % rings, c = (i + 1) * rings + j, d = (i + 1) * rings + (j + 1) % rings;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(indices);
  const tube = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  tube.frustumCulled = false; world.add(tube);

  const curtainPos = new Float32Array(count * 6);
  const curtainCol = new Float32Array(count * 6);
  const curtainIndices = [];
  for (let i = 0; i < count - 1; i++) curtainIndices.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  const curtainGeometry = new THREE.BufferGeometry();
  curtainGeometry.setAttribute('position', new THREE.BufferAttribute(curtainPos, 3).setUsage(THREE.DynamicDrawUsage));
  curtainGeometry.setAttribute('color', new THREE.BufferAttribute(curtainCol, 3).setUsage(THREE.DynamicDrawUsage));
  curtainGeometry.setIndex(curtainIndices);
  const curtain = new THREE.Mesh(curtainGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .36, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
  curtain.frustumCulled = false; world.add(curtain);

  const envelopeGeo = new THREE.BufferGeometry();
  envelopeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const envelope = new THREE.Line(envelopeGeo, new THREE.LineBasicMaterial({ color: '#557984', transparent: true, opacity: .4 }));
  envelope.frustumCulled = false; envelope.visible = p.view === 'wave'; world.add(envelope);
  line([[-12.7, baseY, 0], [12.7, baseY, 0]], '#6b8d9b', .65);
  const tick = extent >= 25 ? 10 : extent > 12 ? 5 : 2;
  for (let x = Math.ceil(-extent / tick) * tick; x <= extent; x += tick) {
    line([[x * xScale, baseY - .13, 0], [x * xScale, baseY + .13, 0]], '#7893a0', .7);
    label(String(x).replace('-', '−'), [x * xScale, baseY - .62, 0], { size: .35 });
  }
  label('x', [13.1, baseY - .03, 0], { size: .47 });
  label(p.view === 'wave' ? 'Re ψ' : '|ψ|²', [-12.4, 4.8, 0], { size: .43, color: '#80b7bd' });
  if (p.view === 'wave') {
    line([[-12.4, baseY, -4], [-12.4, baseY, 4]], '#39596a', .4);
    label('Im ψ', [-12.4, baseY, 4.4], { size: .4 });
  }
  ground(28, baseY - .035, 28);
  if (currentScene === 'barrier') {
    barrierBox(0, p.barrierWidth * xScale, 3.5, 0, 5.5, baseY);
    label(`V₀ = ${fmt(p.barrierHeight, 1)}`, [.3, 3.8, 0], { size: .45, color: '#c6a67f' });
  } else if (currentScene === 'oscillator') {
    const potential = [];
    for (let i = 0; i < 250; i++) {
      const x = -extent + i * 2 * extent / 249;
      const y = baseY + .5 * p.omega ** 2 * x ** 2 * .9;
      if (y < 8) potential.push([x * xScale, y, -.3]);
    }
    line(potential, '#c5a071', .65);
    label('V = ½ω²x²', [8.3, 5.5, -.3], { size: .45, color: '#b6a181' });
  } else if (currentScene === 'well') {
    const limit = p.wellWidth * xScale / 2;
    barrierBox(-limit - .13, .26, 3.5, 0, 6, baseY);
    barrierBox(limit + .13, .26, 3.5, 0, 6, baseY);
    label('V → ∞', [-limit, 4.4, 0], { size: .4, color: '#b6a181' });
    label('V → ∞', [limit, 4.4, 0], { size: .4, color: '#b6a181' });
  }
  visual = { tube, curtain, envelope, extent, xScale, start, count, rings, radius, baseY, densityScale, waveScale };
  resetCamera(currentCameraKind !== 'wave');
  updateWaveVisual();
}

const tempColor = new THREE.Color();
function phaseColor(angle, target = tempColor) {
  const f = ((angle / (2 * Math.PI)) % 1 + 1) % 1 * 4;
  const i = Math.floor(f);
  return target.copy(PHASE_STOPS[i]).lerp(PHASE_STOPS[i + 1], f - i);
}

function updateWaveVisual() {
  if (!solver || !visual.tube) return;
  const p = settings[currentScene];
  const v = visual;
  const pos = v.tube.geometry.attributes.position.array;
  const col = v.tube.geometry.attributes.color.array;
  const cp = v.curtain.geometry.attributes.position.array;
  const cc = v.curtain.geometry.attributes.color.array;
  const ep = v.envelope.geometry.attributes.position.array;
  for (let j = 0; j < v.count; j++) {
    const i = j + v.start;
    const re = solver.re[i], im = solver.im[i], rho = re * re + im * im;
    const x = (i - solver.n / 2) * solver.dx * v.xScale;
    const y = v.baseY + (p.view === 'wave' ? re * v.waveScale : rho * v.densityScale);
    const z = p.view === 'wave' ? im * v.waveScale : 0;
    const c = p.view === 'wave' ? phaseColor(Math.atan2(im, re)) : CYAN;
    for (let a = 0; a < v.rings; a++) {
      const index = (j * v.rings + a) * 3;
      const theta = a / v.rings * Math.PI * 2;
      pos[index] = x; pos[index + 1] = y + Math.sin(theta) * v.radius; pos[index + 2] = z + Math.cos(theta) * v.radius;
      const light = 1.1 + .55 * Math.sin(theta);
      col[index] = c.r * light; col[index + 1] = c.g * light; col[index + 2] = c.b * light;
    }
    cp[j * 6] = x; cp[j * 6 + 1] = v.baseY; cp[j * 6 + 2] = 0;
    cp[j * 6 + 3] = x; cp[j * 6 + 4] = y; cp[j * 6 + 5] = z;
    cc[j * 6] = c.r * .03; cc[j * 6 + 1] = c.g * .03; cc[j * 6 + 2] = c.b * .03;
    cc[j * 6 + 3] = c.r; cc[j * 6 + 4] = c.g; cc[j * 6 + 5] = c.b;
    ep[j * 3] = x; ep[j * 3 + 1] = v.baseY + Math.sqrt(rho) * v.waveScale; ep[j * 3 + 2] = 0;
  }
  v.tube.geometry.attributes.position.needsUpdate = true;
  v.tube.geometry.attributes.color.needsUpdate = true;
  v.curtain.geometry.attributes.position.needsUpdate = true;
  v.curtain.geometry.attributes.color.needsUpdate = true;
  v.envelope.geometry.attributes.position.needsUpdate = true;
  chartDirty = true;
}

function build2D() {
  clearWorld();
  const model = sim2, n = model.n, scale = .7;
  const count = n * n;
  const pos = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = (j * n + i) * 3;
    pos[k] = (i - n / 2) * model.dx * scale;
    pos[k + 1] = -2;
    pos[k + 2] = -(j - n / 2) * model.dx * scale;
  }
  const indices = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: false }));
  mesh.frustumCulled = false; world.add(mesh);
  const p = model.params;
  const half = model.length / 2;
  const cuts = [-half, -p.slitSeparation / 2 - p.slitWidth / 2, -p.slitSeparation / 2 + p.slitWidth / 2, p.slitSeparation / 2 - p.slitWidth / 2, p.slitSeparation / 2 + p.slitWidth / 2, half];
  for (let j = 0; j < 3; j++) {
    const low = cuts[j * 2], high = cuts[j * 2 + 1];
    barrierBox(0, p.barrierWidth * scale, (high - low) * scale, -(low + high) / 2 * scale, 2.2, -1.99);
  }
  const edge = half * scale;
  line([[-edge, -1.99, -edge], [edge, -1.99, -edge], [edge, -1.99, edge], [-edge, -1.99, edge], [-edge, -1.99, -edge]], '#436370', .6);
  line([[6 * scale, -1.96, -edge], [6 * scale, -1.96, edge]], '#c9b294', .7, true);
  label('x = 6', [6 * scale, -1.7, edge + .7], { size: .42, color: '#c6b38d' });
  label('x', [edge + .7, -2, 0], { size: .52 });
  label('y', [-edge, -2, -edge - .7], { size: .52 });
  label('V₀ = 12', [-.3, .9, -8], { size: .46, color: '#c9a777' });
  for (const x of [-10, -5, 0, 5, 10]) {
    label(String(x).replace('-', '−'), [x * scale, -2.05, edge + .6], { size: .34 });
  }
  visual = { mesh, scale, initialPeak: 1 / (2 * Math.PI * p.sigmaX * p.sigmaY) };
  resetCamera(currentCameraKind !== 'slits');
  update2DVisual();
}

function update2DVisual() {
  if (!sim2 || !visual.mesh) return;
  const pos = visual.mesh.geometry.attributes.position.array;
  const col = visual.mesh.geometry.attributes.color.array;
  const mode = settings.slits.view;
  for (let i = 0; i < sim2.re.length; i++) {
    const a = sim2.re[i], b = sim2.im[i], density = a * a + b * b;
    const value = clamp(density / visual.initialPeak, 0, 3);
    const intensity = Math.pow(clamp(value, 0, 1), .46);
    pos[i * 3 + 1] = -2 + value * 5;
    const c = mode === 'phase' ? phaseColor(Math.atan2(b, a)) : tempColor.copy(CYAN).lerp(PALE, clamp(value - .55, 0, 1));
    col[i * 3] = .003 + c.r * intensity * 1.1;
    col[i * 3 + 1] = .009 + c.g * intensity * 1.1;
    col[i * 3 + 2] = .014 + c.b * intensity * 1.1;
  }
  visual.mesh.geometry.attributes.position.needsUpdate = true;
  visual.mesh.geometry.attributes.color.needsUpdate = true;
  chartDirty = true;
}

function resetCamera(force = true) {
  if (!camera) return;
  const kind = currentScene === 'atom' ? 'atom' : currentScene === 'slits' ? 'slits' : currentScene === 'spinor' ? 'spinor' : 'wave';
  if (!force && currentCameraKind === kind) return;
  currentCameraKind = kind;
  const aspectFactor = Math.max(1, 1 / camera.aspect);
  if (kind === 'atom') {
    const distance = 29 * Math.min(aspectFactor, 1.65);
    camera.position.set(distance * .20, distance * .09, distance);
    controls.target.set(0, -.15, 0);
  } else if (kind === 'spinor') {
    const viewport = $('#viewport');
    const header = $('.scene-header');
    const bottom = $('.scene-bottom');
    spinorLab.view?.fitCamera(camera, controls, {
      width: viewport.clientWidth, height: viewport.clientHeight,
      top: header.offsetTop + header.offsetHeight + 18,
      bottom: viewport.clientHeight - bottom.offsetTop + 14,
      left: mobile.matches ? 16 : 26, right: mobile.matches ? 16 : 26,
    });
  } else if (kind === 'slits') {
    const distance = 32 * Math.min(aspectFactor, 1.5);
    if (settings.slits.top) camera.position.set(0, distance * 1.13, .01);
    else camera.position.set(-distance * .35, distance * .66, distance * .74);
    controls.target.set(0, -1, 0);
  } else {
    const distance = 31 * Math.min(aspectFactor, 1.9);
    camera.position.set(0, distance * .21, distance);
    controls.target.set(0, 0, 0);
  }
  controls.minDistance = 7;
  controls.maxDistance = kind === 'spinor' ? Math.max(100, camera.position.distanceTo(controls.target) * 2) : 100;
  camera.far = Math.max(250, controls.maxDistance * 2);
  camera.updateProjectionMatrix();
  controls.update();
}

function resize() {
  if (!renderer) return;
  const bounds = $('#viewport').getBoundingClientRect();
  renderer.setSize(bounds.width, bounds.height, false);
  camera.aspect = bounds.width / Math.max(1, bounds.height);
  camera.updateProjectionMatrix();
  resetCamera(true);
  positionStateTag();
  chartDirty = true;
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile.matches ? 1.75 : 2));
  renderer.setClearColor('#090e13');
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  $('#viewport').appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Three.js: квантовая волновая функция');
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(43, 1, .1, 250);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .075;
  controls.enablePan = false;
  controls.rotateSpeed = .6;
  controls.zoomSpeed = .8;
  controls.autoRotateSpeed = .35;
  controls.addEventListener('start', () => { if (currentScene === 'atom' && running) { running = false; updatePlay(); } });
  renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); running = false; updatePlay(); toast('Графический контекст потерян. Перезагрузите страницу.'); });
  world = new THREE.Group();
  scene.add(world);
  new ResizeObserver(resize).observe($('#viewport'));
  resize();
}

function stopWorker() {
  worker?.terminate();
  worker = null; workerBusy = false; sim2 = null;
  workerVersion++;
}

function start2D() {
  stopWorker();
  solver = null;
  const instance = new Worker(new URL('./physics/worker.mjs', import.meta.url), { type: 'module' });
  worker = instance;
  workerBusy = true;
  $('#loading-text').textContent = 'Готовим двумерное волновое поле…';
  $('#loading').hidden = false;
  instance.onmessage = ({ data }) => {
    if (instance !== worker || data.version !== workerVersion) return;
    workerBusy = false;
    if (data.type === 'error') { $('#loading').hidden = false; $('#loading-text').textContent = `Ошибка расчёта: ${data.message}`; running = false; updatePlay(); return; }
    const count = data.n * data.n;
    sim2 = { ...data, re: data.field.subarray(0, count), im: data.field.subarray(count) };
    simStats = data.stats;
    if (data.type === 'ready') { build2D(); $('#loading').hidden = true; updateStats(); }
    else update2DVisual();
  };
  instance.onerror = () => { $('#loading').hidden = false; $('#loading-text').textContent = 'Не удалось запустить расчёт. Перезагрузите страницу.'; running = false; updatePlay(); };
  instance.postMessage({ type: 'init', version: workerVersion, params: { ...settings.slits, n: settings.slits.n } });
}

function startScene(resetView = true) {
  accumulator = 0;
  running = !reducedMotion;
  if (currentScene === 'atom') {
    stopWorker(); solver = null; buildAtom(); $('#loading').hidden = true;
  } else if (currentScene === 'spinor') {
    stopWorker(); solver = null;
    spinorLab.reset(); clearWorld(); spinorLab.buildView(world);
    spinorLab.renderDetails($('#spinor-details'));
    $('#loading').hidden = true;
  } else if (currentScene === 'slits') {
    start2D();
  } else {
    stopWorker();
    solver = new Quantum1D({ n: 1024, length: 64, mode: currentScene, ...settings[currentScene] });
    simStats = solver.stats();
    buildWave(); $('#loading').hidden = true;
  }
  updateMetadata(); updateStats();
  if (resetView) resetCamera(true);
  chartDirty = true;
}

function syncSceneHash() {
  const url = new URL(location.href);
  url.hash = currentScene === 'spinor' ? `spinor/${spinorLab.params.mode}` : currentScene;
  history.replaceState(null, '', url);
}

function readSceneHash() {
  const [id, requestedMode] = location.hash.slice(1).split('/');
  if (!Object.hasOwn(SCENES, id)) return;
  if (id === 'spinor') {
    const mode = ['pauli', 'dirac', 'weyl'].includes(requestedMode) ? requestedMode : 'compare';
    // A direct Pauli link is an explicit choice of a massive model.
    if (mode === 'pauli' && spinorLab.params.mass === 0) spinorLab.params.mass = 1;
    const changed = mode !== spinorLab.params.mode;
    spinorLab.params.mode = mode;
    if (currentScene === id && changed) { buildControls(); startScene(true); syncSceneHash(); }
  }
  if (id !== currentScene) selectScene(id);
}

function selectScene(id) {
  if (!Object.hasOwn(SCENES, id) || id === currentScene) return;
  currentScene = id;
  $$('.experiment').forEach(button => {
    const active = button.dataset.scene === id;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  });
  const button = $(`[data-scene="${id}"]`);
  if (matchMedia('(max-width:980px)').matches) button.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'nearest', inline: 'center' });
  buildControls(); startScene(true);
  syncSceneHash();
}

function maxTime() {
  if (currentScene === 'spinor') return spinorLab.limit;
  return currentScene === 'well' ? 100 : currentScene === 'oscillator' ? 45 : currentScene === 'slits' ? 10 : 11;
}
function currentTime() { return currentScene === 'spinor' ? spinorLab.time : solver?.time ?? sim2?.time ?? 0; }
function updatePlay() {
  $('#pause-icon').toggleAttribute('hidden', !running);
  $('#play-icon').toggleAttribute('hidden', running);
  $('#play').setAttribute('aria-label', currentScene === 'atom' ? (running ? 'Остановить вращение камеры' : 'Вращать камеру') : (running ? 'Пауза' : 'Запустить симуляцию'));
  $('#time-label').textContent = currentScene === 'atom' ? 'ВРАЩЕНИЕ КАМЕРЫ' : running ? 'МОДЕЛЬНОЕ ВРЕМЯ' : 'ПАУЗА';
}

function updateStats() {
  if (currentScene === 'atom') {
    const o = ORBITALS.find(orbital => orbital.id === settings.atom.orbital);
    setStats([
      ['Энергия Eₙ', `${fmt(o.energy, 4)} Eₕ`, true],
      ['Средний радиус ⟨r⟩', `${fmt(o.expectedRadius, 1)} a₀`],
      ['Квантовые числа', `n = ${o.n}, l = ${o.l}`],
      ['Число узлов', `${o.radialNodes.length + o.angularNodeCount}`],
      ['Нормировка ∫|ψ|²', '1,000000'],
    ]);
    $('#time-value').textContent = 'Состояние стационарно';
    return;
  }
  if (currentScene === 'spinor') {
    setStats(spinorLab.statsRows()); spinorLab.updateDetails();
    $('#time-value').textContent = `t = ${fmt(spinorLab.time, 2)} · ℏ = c = 1`;
    const progress = clamp(spinorLab.time / spinorLab.limit, 0, 1) * 100;
    $('#progress-fill').style.width = `${progress}%`;
    $('#progress-track').setAttribute('aria-valuenow', String(Math.round(progress)));
    return;
  }
  if (!solver && !sim2) return;
  if (solver) simStats = solver.stats();
  const s = simStats;
  const p = settings[currentScene];
  if (currentScene === 'barrier') {
    setStats([
      ['Справа от барьера', percent(s.right), true],
      ['Слева от барьера', percent(s.left)],
      ['Внутри барьера', percent(s.barrier)],
      ['Центральная энергия E₀', fmt(p.k0 ** 2 / 2, 3)],
      ['Начальная доля E > V₀', percent(s.aboveBarrierFraction ?? 0)],
      ['Поглощено на краях', percent(s.absorbed)],
      ['Норма + поглощено', fmt(s.accounted, 6)],
    ]);
  } else if (currentScene === 'slits') {
    setStats([
      ['Справа от щелей', percent(s.right), true],
      ['Осталось в области', percent(s.norm)],
      ['Поглощено на краях', percent(s.absorbed)],
      ['Норма + поглощено', fmt(s.accounted, 6)],
    ]);
  } else if (currentScene === 'well') {
    const factor = Math.PI ** 2 / (2 * p.wellWidth ** 2);
    setStats([
      ['Энергия E₁', fmt(factor, 4)],
      [`Энергия E${p.n2}`, fmt(factor * p.n2 ** 2, 4)],
      ['Среднее положение ⟨x⟩', fmt(s.xMean, 3), true],
      ['Ширина σₓ', fmt(s.sigmaX, 3)],
      ['Нормировка ∫|ψ|²', fmt(s.norm, 6)],
    ]);
  } else {
    const rows = [['Среднее положение ⟨x⟩', fmt(s.xMean, 3), true], ['Ширина σₓ', fmt(s.sigmaX, 3)]];
    if (currentScene === 'oscillator') rows.push(['Период 2π/ω', fmt(2 * Math.PI / p.omega, 2)]);
    if (currentScene === 'free') rows.push(['Длина волны λ₀', fmt(2 * Math.PI / p.k0, 3)]);
    rows.push(['Осталось в области', percent(s.norm)], ['Поглощено на краях', percent(s.absorbed)], ['Норма + поглощено', fmt(s.accounted, 6)]);
    setStats(rows);
  }
  $('#time-value').textContent = `t = ${fmt(currentTime(), 2)} · ℏ = m = 1`;
  const progress = clamp(currentTime() / maxTime(), 0, 1) * 100;
  $('#progress-fill').style.width = `${progress}%`;
  $('#progress-track').setAttribute('aria-valuenow', String(Math.round(progress)));
}

function drawChart() {
  const canvas = $('#chart');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = Math.min(devicePixelRatio, 2);
  if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) { canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr); }
  const context = canvas.getContext('2d');
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = rect.width, h = rect.height;
  if (currentScene === 'spinor') { spinorLab.drawChart(context, w, h); chartDirty = false; return; }
  const padding = { left: 25, right: 8, top: 9, bottom: 24 };
  const pw = w - padding.left - padding.right, ph = h - padding.top - padding.bottom;
  context.clearRect(0, 0, w, h);
  let data = [], minX = 0, maxX = 1, maxY = 1, unit = 'x';
  if (currentScene === 'atom') {
    const o = ORBITALS.find(orbital => orbital.id === settings.atom.orbital);
    maxX = o.displayExtent;
    for (let i = 0; i <= 200; i++) data.push([i * maxX / 200, radialProbability(o.id, i * maxX / 200)]);
    maxY = Math.max(...data.map(p => p[1])) * 1.13;
    unit = 'r / a₀';
  } else if (currentScene === 'slits') {
    minX = -12; maxX = 12; unit = 'y'; maxY = .014;
    if (sim2) {
      const xIndex = Math.round(6 / sim2.dx + sim2.n / 2);
      for (let j = 0; j < sim2.n; j++) {
        const y = (j - sim2.n / 2) * sim2.dx;
        if (y >= minX && y <= maxX) {
          const k = j * sim2.n + xIndex;
          data.push([y, sim2.re[k] ** 2 + sim2.im[k] ** 2]);
        }
      }
      maxY = Math.max(.00015, ...data.map(point => point[1])) * 1.15;
    }
  } else {
    minX = -waveLimits(); maxX = waveLimits();
    maxY = currentScene === 'well' ? 4.4 / settings.well.wellWidth : currentScene === 'oscillator' ? Math.sqrt(settings.oscillator.omega / Math.PI) * 1.2 : (currentScene === 'barrier' ? 4.4 : 1.3) / (Math.sqrt(2 * Math.PI) * (settings[currentScene].sigma || 2));
    if (solver) for (let i = 0; i < solver.n; i++) {
      const x = (i - solver.n / 2) * solver.dx;
      if (x >= minX && x <= maxX) data.push([x, solver.re[i] ** 2 + solver.im[i] ** 2]);
    }
  }
  const X = x => padding.left + (x - minX) / (maxX - minX) * pw;
  const Y = y => padding.top + ph - y / maxY * ph;
  context.font = '8px "IBM Plex Mono",monospace'; context.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    const y = maxY * i / 2;
    context.strokeStyle = '#23333f'; context.beginPath(); context.moveTo(padding.left, Y(y)); context.lineTo(w - padding.right, Y(y)); context.stroke();
    context.textAlign = 'right'; context.textBaseline = 'middle'; context.fillStyle = '#567787';
    context.fillText(y ? (y < .01 ? y.toFixed(3) : y.toFixed(2)) : '0', padding.left - 5, Y(y));
  }
  if (currentScene === 'barrier') {
    const bw = settings.barrier.barrierWidth;
    context.fillStyle = '#ae895127'; context.fillRect(X(-bw / 2), padding.top, Math.max(2, X(bw / 2) - X(-bw / 2)), ph);
  }
  context.save(); context.beginPath(); context.rect(padding.left, padding.top, pw, ph + 1); context.clip();
  if (data.length) {
    const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + ph);
    gradient.addColorStop(0, '#72ded82f'); gradient.addColorStop(1, '#72ded804');
    context.beginPath(); context.moveTo(X(data[0][0]), Y(0));
    data.forEach(([x, y]) => context.lineTo(X(x), Y(y)));
    context.lineTo(X(data[data.length - 1][0]), Y(0)); context.closePath(); context.fillStyle = gradient; context.fill();
    context.beginPath(); data.forEach(([x, y], i) => i ? context.lineTo(X(x), Y(y)) : context.moveTo(X(x), Y(y)));
    context.strokeStyle = '#72ded8'; context.lineWidth = 1.4; context.stroke();
  }
  context.restore();
  context.fillStyle = '#7593a1'; context.textAlign = 'center'; context.textBaseline = 'top';
  for (let j = 0; j < 3; j++) {
    const x = minX + (maxX - minX) * j / 2;
    context.fillText(String(Math.round(x)).replace('-', '−'), X(x), padding.top + ph + 8);
  }
  context.textAlign = 'right'; context.fillStyle = '#7899a7';
  context.fillText(unit, w - padding.right, 0);
  chartDirty = false;
}

function animate(now) {
  const delta = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  frameCount++;
  if (now - fpsSince > 1200) {
    $('#fps').textContent = `${Math.round(frameCount * 1000 / (now - fpsSince))} fps`;
    frameCount = 0; fpsSince = now;
  }
  if (!document.hidden) {
    controls.autoRotate = currentScene === 'atom' && running;
    controls.autoRotateSpeed = .35 * speed;
    controls.update(delta);
    if (running && currentScene !== 'atom') {
      if (currentTime() >= maxTime()) { running = false; updatePlay(); $('#time-label').textContent = 'ОПЫТ ЗАВЕРШЁН'; }
      else if (currentScene === 'spinor') {
        spinorLab.advance(delta * 1.7 * speed);
        chartDirty = true;
      } else if (solver) {
        const rate = currentScene === 'well' ? 7 : currentScene === 'oscillator' ? 2 : 1.7;
        accumulator = Math.min(.18, accumulator + delta * rate * speed);
        const steps = Math.min(18, Math.floor(accumulator / .01));
        if (steps > 0) { solver.step(.01, steps); accumulator -= steps * .01; updateWaveVisual(); }
      } else if (worker && sim2) {
        accumulator = Math.min(.16, accumulator + delta * 2.2 * speed);
        const steps = Math.min(16, Math.floor(accumulator / .008));
        if (!workerBusy && steps > 0) {
          accumulator -= steps * .008;
          workerBusy = true;
          worker.postMessage({ type: 'step', version: workerVersion, steps });
        }
      }
    }
    renderer.render(scene, camera);
    if (now - lastStats > 150) { updateStats(); if (chartDirty) drawChart(); lastStats = now; }
  }
}

function wireUI() {
  $$('.experiment').forEach(button => button.addEventListener('click', () => selectScene(button.dataset.scene)));
  $('#play').addEventListener('click', () => {
    if (!running && currentScene !== 'atom' && currentTime() >= maxTime()) startScene(false);
    else running = !running;
    accumulator = 0; updatePlay();
  });
  $('#restart').addEventListener('click', () => startScene(true));
  $('#reset-view').addEventListener('click', () => resetCamera(true));
  $$('[data-speed]').forEach(button => button.addEventListener('click', () => {
    speed = +button.dataset.speed;
    $$('[data-speed]').forEach(b => b.classList.toggle('active', b === button));
  }));
  $('#mobile-settings').addEventListener('click', () => $('#inspector').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' }));
  const openAbout = () => $('#about').showModal();
  $('#about-open').addEventListener('click', openAbout);
  $('#details-open').addEventListener('click', openAbout);
  $('#about-close').addEventListener('click', () => $('#about').close());
  $('#about').addEventListener('click', event => { if (event.target === $('#about')) { const r = $('#about').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#about').close(); } });
  $('#fullscreen').addEventListener('click', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else toast('На этом устройстве приблизьте сцену жестом двумя пальцами.');
    } catch { toast('Полноэкранный режим недоступен в этом браузере.'); }
  });
  document.addEventListener('keydown', event => {
    if ($('#about').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); $('#play').click(); }
    if (event.code === 'KeyR') $('#restart').click();
  });
  document.addEventListener('visibilitychange', () => { lastFrame = performance.now(); accumulator = 0; });
  addEventListener('hashchange', readSceneHash);
}

try {
  initRenderer(); wireUI(); buildControls(); startScene(true);
  readSceneHash();
  renderer.setAnimationLoop(animate);
  await document.fonts.ready;
  positionStateTag();
  if (currentScene === 'spinor') resetCamera(true);
  chartDirty = true;
} catch (error) {
  console.error(error);
  $('#loading').hidden = false;
  $('#loading-text').textContent = `Не удалось запустить WebGL. ${error.message}`;
  $('#fps').textContent = '—';
}

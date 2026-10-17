import * as THREE from 'three';

/** Component order follows model.components, including the chiral Dirac basis. */
export const COMPONENT_COLORS = Object.freeze(['#72ded8', '#e8b87d', '#8daee7', '#cc91b4']);
// A layout offset only: each component retains its exact physical x and density.
export const COMPONENT_DEPTH_HALF_SPAN = .3;

const MODEL_COLORS = { pauli: '#e8b87d', dirac: '#72ded8', weyl: '#cc91b4' };
const BASE_Y = -2.1;
const X_WIDTH = 28;
const LANE_SPACING = 5.8;
const PEAK_HEIGHT = 4.6;
const SPIN_LENGTH = 1.12;
const UP = new THREE.Vector3(0, 1, 0);
const RING_COS = [1, 0, -1, 0];
const RING_SIN = [0, 1, 0, -1];

/**
 * 1D density plots arranged in separate model lanes, with genuine local spin.
 * Height is linear in density; lane depth is a categorical layout coordinate.
 * Models are held by reference. Recreate the view if their grid/basis changes.
 * The parent owns disposal of the attached geometries, materials and textures.
 */
export class SpinorView {
  constructor(parentGroup, entries, options = {}) {
    if (!parentGroup?.add || !Array.isArray(entries) || entries.length < 1 || entries.length > 3) {
      throw new TypeError('SpinorView expects a Three.js group and one to three model entries.');
    }
    this.view = options.view === 'components' ? 'components' : 'density';
    this.showSpin = options.showSpin !== false;
    this.xMin = options.xMin ?? -28;
    this.xMax = options.xMax ?? 28;
    if (!(this.xMax > this.xMin)) throw new RangeError('SpinorView requires xMax > xMin.');
    this.xScale = X_WIDTH / (this.xMax - this.xMin);
    this.xCenter = (this.xMin + this.xMax) * .5;

    // Set once from the specified initial scalar envelope, never the live peak.
    const sigma = options.sigma ?? entries[0].model.params?.sigma ?? entries[0].model.sigma ?? 2.4;
    if (!(sigma > 0)) throw new RangeError('The initial packet width must be positive.');
    this.referenceDensity = 1 / (Math.sqrt(2 * Math.PI) * sigma);
    this.densityScale = PEAK_HEIGHT / this.referenceDensity;
    this.group = new THREE.Group();
    this.group.name = 'spinor-density-lanes';
    this.group.userData = { horizontal: 'x', vertical: 'probability density', depth: 'model / component layout, not a spatial coordinate' };
    parentGroup.add(this.group);
    this._dummy = new THREE.Object3D();
    this._direction = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this.lanes = entries.map((entry, index) => this._createLane(entry, (index - (entries.length - 1) * .5) * LANE_SPACING));
    this._createAxes();
    const laneExtent = (entries.length - 1) * LANE_SPACING * .5;
    this.bounds = new THREE.Box3(
      new THREE.Vector3(-15.6, BASE_Y - 1.4, -laneExtent - 1.4),
      new THREE.Vector3(15.3, BASE_Y + PEAK_HEIGHT + SPIN_LENGTH + .95, laneExtent + 2.1),
    );
    this.update();
  }

  _x(i, model) { return ((i - model.n / 2) * model.dx - this.xCenter) * this.xScale; }

  _createLane(entry, z) {
    const model = entry.model;
    if (!(model?.n > 1) || !(model.dx > 0) || !model.density || !Array.isArray(model.components)) {
      throw new TypeError('SpinorView requires the Spinor1D density, grid and component arrays.');
    }
    const start = Math.max(0, Math.ceil(model.n / 2 + this.xMin / model.dx));
    const end = Math.min(model.n - 1, Math.floor(model.n / 2 + this.xMax / model.dx));
    const count = end - start + 1;
    if (count < 2) throw new RangeError('The displayed interval must overlap at least two grid samples.');
    const color = entry.color ?? MODEL_COLORS[entry.id] ?? COMPONENT_COLORS[0];
    const group = new THREE.Group();
    group.name = `spinor-${entry.id}`;
    this.group.add(group);
    const lane = { entry, model, group, z, start, end, count, color };
    lane.total = this._createCurve(lane, color, .031, 1);
    lane.total.object.name = `${entry.id}-total-density`;
    lane.components = model.components.map((component, index) => {
      const curve = this._createCurve(lane, COMPONENT_COLORS[index % COMPONENT_COLORS.length], .025, .98);
      curve.object.name = `${entry.id}-${component.label ?? index}-density`;
      curve.zOffset = model.components.length > 1 ? COMPONENT_DEPTH_HALF_SPAN * (2 * index / (model.components.length - 1) - 1) : 0;
      return curve;
    });

    const positions = new Float32Array(count * 6);
    const colors = new Float32Array(count * 6);
    const indices = new Uint32Array((count - 1) * 6);
    const bright = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const offset = i * 6, x = this._x(start + i, model);
      positions[offset] = positions[offset + 3] = x;
      positions[offset + 1] = positions[offset + 4] = BASE_Y;
      positions[offset + 2] = positions[offset + 5] = z;
      colors[offset] = bright.r * .06; colors[offset + 1] = bright.g * .06; colors[offset + 2] = bright.b * .06;
      colors[offset + 3] = bright.r; colors[offset + 4] = bright.g; colors[offset + 5] = bright.b;
      if (i < count - 1) indices.set([2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3], 6 * i);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .27, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const curtain = new THREE.Mesh(geometry, material);
    curtain.name = `${entry.id}-density-curtain`;
    curtain.frustumCulled = false;
    group.add(curtain);
    lane.curtain = { object: curtain, positions, attribute: geometry.getAttribute('position') };

    this._line([[-14, BASE_Y, z], [14, BASE_Y, z]], color, .25, group);
    this._label(entry.label ?? entry.id, [-12.15, BASE_Y + 1.0, z], .96, color, group);

    // Both parts are instanced and re-use one transform object on every frame.
    const stride = Math.max(1, Math.round(1.4 / (model.dx * this.xScale)));
    lane.spinSamples = [];
    for (let i = start + Math.floor(stride / 2); i <= end; i += stride) lane.spinSamples.push(i);
    const spinColor = new THREE.Color('#e8f2df').lerp(new THREE.Color(color), .24);
    const spinMaterial = new THREE.MeshBasicMaterial({ color: spinColor, transparent: true, opacity: .86, depthWrite: false });
    const stem = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6, 1), spinMaterial, lane.spinSamples.length);
    const head = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 8, 1), spinMaterial, lane.spinSamples.length);
    for (const object of [stem, head]) {
      object.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      object.frustumCulled = false;
      object.renderOrder = 3;
      group.add(object);
    }
    stem.name = `${entry.id}-local-spin-stems`;
    head.name = `${entry.id}-local-spin-heads`;
    lane.spin = { stem, head };
    return lane;
  }

  _createCurve(lane, color, radius, opacity) {
    const positions = new Float32Array(lane.count * 12);
    const indices = new Uint32Array((lane.count - 1) * 24);
    for (let i = 0; i < lane.count - 1; i++) for (let ring = 0; ring < 4; ring++) {
      const a = 4 * i + ring, b = 4 * i + (ring + 1) % 4, c = a + 4, d = b + 4;
      indices.set([a, c, b, b, c, d], 24 * i + 6 * ring);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
    const object = new THREE.Mesh(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = 2;
    lane.group.add(object);
    return { object, positions, attribute: geometry.getAttribute('position'), radius, zOffset: 0 };
  }

  _line(points, color, opacity, parent = this.group) {
    const geometry = new THREE.BufferGeometry().setFromPoints(points.map(point => new THREE.Vector3(...point)));
    const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const object = new THREE.Line(geometry, material);
    parent.add(object);
    return object;
  }

  _label(text, position, size, color = '#789ba9', parent = this.group) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    const font = '500 48px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    context.font = font;
    canvas.width = Math.ceil(context.measureText(text).width + 32);
    canvas.height = 80;
    context.font = font;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false, opacity: .9 });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(...position);
    sprite.scale.set(size * canvas.width / canvas.height, size, 1);
    sprite.renderOrder = 4;
    parent.add(sprite);
    return sprite;
  }

  _createAxes() {
    const front = this.lanes[this.lanes.length - 1].z;
    const back = this.lanes[0].z;
    for (let x = Math.ceil(this.xMin / 10) * 10; x <= this.xMax; x += 10) {
      const worldX = (x - this.xCenter) * this.xScale;
      this._line([[worldX, BASE_Y - .015, back - .6], [worldX, BASE_Y - .015, front + .6]], '#34505d', x === 0 ? .27 : .14);
      for (const lane of this.lanes) this._line([[worldX, BASE_Y, lane.z - .11], [worldX, BASE_Y, lane.z + .11]], '#6b8d98', .4);
      if (x % 20 === 0) this._label(String(x), [worldX, BASE_Y - .64, front + .72], .69);
    }
    this._label('x', [14.6, BASE_Y - .05, front + .7], .83, '#a2b8bf');

    const axisX = -14.4, axisZ = front + .55;
    this._line([[axisX, BASE_Y, axisZ], [axisX, BASE_Y + PEAK_HEIGHT * 1.25, axisZ]], '#52727c', .3);
    this._label('ρ', [axisX, BASE_Y + PEAK_HEIGHT * 1.25 + .42, axisZ], .9, '#a2b8bf');
    const magnitude = 10 ** Math.floor(Math.log10(this.referenceDensity));
    const fraction = this.referenceDensity / magnitude;
    const tick = (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * magnitude;
    const digits = Math.max(0, -Math.floor(Math.log10(tick)));
    for (let density = tick; density <= this.referenceDensity * 1.25; density += tick) {
      const y = BASE_Y + density * this.densityScale;
      this._line([[axisX - .1, y, axisZ], [axisX + .1, y, axisZ]], '#6b8d98', .4);
      this._label(density.toFixed(digits), [axisX - .65, y, axisZ], .64);
    }
  }

  _updateCurve(curve, lane, density) {
    const { positions, radius } = curve;
    for (let j = 0; j < lane.count; j++) {
      const i = lane.start + j;
      const x = this._x(i, lane.model), y = BASE_Y + Math.max(0, density[i]) * this.densityScale;
      for (let ring = 0; ring < 4; ring++) {
        const offset = j * 12 + ring * 3;
        positions[offset] = x;
        positions[offset + 1] = y + RING_COS[ring] * radius;
        positions[offset + 2] = lane.z + curve.zOffset + RING_SIN[ring] * radius;
      }
    }
    curve.attribute.needsUpdate = true;
  }

  _updateSpin(lane) {
    const { model, spin } = lane;
    spin.stem.visible = spin.head.visible = this.showSpin;
    if (!this.showSpin) return;
    let visible = 0;
    const threshold = this.referenceDensity * .045;
    for (const i of lane.spinSamples) {
      if (!(model.density[i] > threshold)) continue;
      // World mapping matches the laboratory axes: (sx, sy, sz) -> (sx, sz, -sy).
      this._direction.set(model.spinX[i], model.spinZ[i], -model.spinY[i]);
      const polarization = this._direction.length();
      if (!(polarization > 1e-8)) continue;
      const length = SPIN_LENGTH * polarization;
      this._direction.multiplyScalar(1 / polarization);
      const x = this._x(i, model);
      const tipX = x + this._direction.x * length;
      if (tipX < -14 || tipX > 14) continue;
      // Keep downward arrows above the density curtain as well. The anchor
      // height is a display offset; vector direction and length are unchanged.
      this._origin.set(x, BASE_Y + model.density[i] * this.densityScale + .19 + Math.max(0, -this._direction.y * length), lane.z);
      this._dummy.quaternion.setFromUnitVectors(UP, this._direction);
      this._dummy.position.copy(this._origin).addScaledVector(this._direction, length * .38);
      this._dummy.scale.set(.016 * polarization, length * .76, .016 * polarization);
      this._dummy.updateMatrix();
      spin.stem.setMatrixAt(visible, this._dummy.matrix);
      this._dummy.position.copy(this._origin).addScaledVector(this._direction, length * .88);
      this._dummy.scale.set(.080 * polarization, length * .24, .080 * polarization);
      this._dummy.updateMatrix();
      spin.head.setMatrixAt(visible, this._dummy.matrix);
      visible++;
    }
    spin.stem.count = spin.head.count = visible;
    spin.stem.instanceMatrix.needsUpdate = spin.head.instanceMatrix.needsUpdate = true;
  }

  /** Toggle the representation without reallocating scene geometry. */
  setView(view) {
    this.view = view === 'components' ? 'components' : 'density';
    this.update();
  }

  setSpinVisible(visible) {
    this.showSpin = Boolean(visible);
    for (const lane of this.lanes) this._updateSpin(lane);
  }

  /**
   * Fit the fixed plot bounds into the unobstructed canvas rectangle, in pixels.
   * No view offset or scissor is used: the orbit target moves with the framing.
   * elevation is camera y / z; x = 0 keeps physical x horizontal on screen.
   * Returns the applied distance, target and available NDC rectangle for audits.
   */
  fitCamera(camera, controls, { width, height, top = 0, bottom = 0, left = 16, right = 16, elevation = .45, margin = 1.05 }) {
    if (!(width > left + right) || !(height > top + bottom)) throw new RangeError('Camera framing requires a positive unobstructed canvas area.');
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov * .5)) / camera.zoom;
    const tanX = tanY * camera.aspect;
    const xMin = -1 + 2 * left / width, xMax = 1 - 2 * right / width;
    const yMin = -1 + 2 * bottom / height, yMax = 1 - 2 * top / height;
    const centerX = (xMin + xMax) * .5, centerY = (yMin + yMax) * .5;
    const halfX = (xMax - xMin) * .5, halfY = (yMax - yMin) * .5;
    const center = this.bounds.getCenter(new THREE.Vector3());
    const direction = new THREE.Vector3(0, elevation, 1).normalize();
    const horizontal = new THREE.Vector3(1, 0, 0);
    const vertical = new THREE.Vector3().crossVectors(direction, horizontal);
    const corner = new THREE.Vector3();
    let distance = camera.near * 2;
    for (const x of [this.bounds.min.x, this.bounds.max.x]) for (const y of [this.bounds.min.y, this.bounds.max.y]) for (const z of [this.bounds.min.z, this.bounds.max.z]) {
      corner.set(x, y, z).sub(center);
      const r = corner.dot(horizontal), u = corner.dot(vertical), v = corner.dot(direction);
      // For target shifts proportional to distance, each frustum constraint is
      // linear in distance. Taking the maximum gives the exact enclosing fit.
      distance = Math.max(distance,
        v + Math.abs(r / tanX + centerX * v) / halfX,
        v + Math.abs(u / tanY + centerY * v) / halfY,
        v + camera.near * 2,
      );
    }
    distance *= Math.max(1, margin);
    const target = center.clone()
      .addScaledVector(horizontal, -centerX * distance * tanX)
      .addScaledVector(vertical, -centerY * distance * tanY);
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.up.set(0, 1, 0);
    camera.lookAt(target);
    if (controls?.target) controls.target.copy(target);
    camera.updateMatrixWorld();
    return { distance, target, ndc: { xMin, xMax, yMin, yMax } };
  }

  update() {
    const componentsVisible = this.view === 'components';
    for (const lane of this.lanes) {
      const { model } = lane;
      // In component mode the thin total outline retains the model colour.
      lane.total.radius = componentsVisible ? .014 : .031;
      lane.total.object.material.opacity = componentsVisible ? .34 : 1;
      this._updateCurve(lane.total, lane, model.density);
      lane.curtain.object.visible = !componentsVisible;
      if (!componentsVisible) {
        for (let j = 0; j < lane.count; j++) lane.curtain.positions[j * 6 + 4] = BASE_Y + Math.max(0, model.density[lane.start + j]) * this.densityScale;
        lane.curtain.attribute.needsUpdate = true;
      }
      for (let k = 0; k < lane.components.length; k++) {
        const curve = lane.components[k];
        curve.object.visible = componentsVisible;
        if (componentsVisible) this._updateCurve(curve, lane, model.componentDensity[k]);
      }
      this._updateSpin(lane);
    }
  }
}

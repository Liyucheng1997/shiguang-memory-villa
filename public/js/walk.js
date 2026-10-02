// 第一人称漫游：WASD/方向键走动，拖动鼠标环顾，滚轮前后，双击地面走过去；与墙、家具碰撞。
import * as THREE from 'three';

const EYE = 1.62, RADIUS = 0.26;
const _v = new THREE.Vector3();

export class Walker {
  constructor(camera, dom, { colliders, floorHeight, obstacles }) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;      // 墙：[{x0,x1,z0,z1}]
    this.floorHeight = floorHeight;  // (x,z) => 地面高度
    this.obstacles = obstacles;      // () => 家具 OBB：[{x,z,hx,hz,rot}]
    this.enabled = false;
    this.pos = new THREE.Vector3(0, 0, 12); // 脚底位置
    this.yaw = Math.PI; this.pitch = -0.05;
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.goal = null;                 // 双击后自动走向的目标
    this.bob = 0;
    this.footY = 0;
    this.dragging = false;
    this.lookVel = { x: 0, y: 0 };

    addEventListener('keydown', e => {
      if (!this.enabled || e.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(k)) { this.keys.add(k); this.goal = null; if (k.startsWith('arrow')) e.preventDefault(); }
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.keys.clear());

    dom.addEventListener('pointerdown', e => {
      if (!this.enabled || e.button !== 0) return;
      this.dragging = true; this.last = [e.clientX, e.clientY];
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener('pointermove', e => {
      if (!this.enabled || !this.dragging) return;
      const dx = e.clientX - this.last[0], dy = e.clientY - this.last[1];
      this.last = [e.clientX, e.clientY];
      const s = e.pointerType === 'touch' ? 0.006 : 0.0038;
      this.yaw += dx * s; this.pitch = THREE.MathUtils.clamp(this.pitch + dy * s, -1.35, 1.35);
    });
    const end = () => { this.dragging = false; };
    dom.addEventListener('pointerup', end); dom.addEventListener('pointercancel', end);
    dom.addEventListener('wheel', e => {
      if (!this.enabled || this.wheelBlocked?.()) return;
      e.preventDefault();
      const f = this.forward();
      this.tryMove(f.x * -e.deltaY * 0.004, f.z * -e.deltaY * 0.004);
    }, { passive: false });

    this.buildJoystick();
  }

  forward() { return _v.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }

  /** 让漫游视角接管：从相机当前姿态推出位置和朝向 */
  syncFromCamera() {
    const c = this.camera;
    const dir = new THREE.Vector3(); c.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
    this.pos.set(c.position.x, this.floorHeight(c.position.x, c.position.z), c.position.z);
    this.footY = this.pos.y;
    this.vel.set(0, 0, 0);
  }
  /** 一个漫游姿态对应的相机位置与注视点（供飞行过渡使用） */
  static pose(x, z, yaw, pitch = -0.08, floor = 0) {
    const pos = new THREE.Vector3(x, floor + EYE, z);
    const target = pos.clone().add(new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)));
    return { pos, target };
  }
  walkTo(x, z) { this.goal = new THREE.Vector2(x, z); }

  // 与墙（AABB）和家具（OBB）的圆形碰撞，推出重叠
  resolve(p) {
    for (let iter = 0; iter < 3; iter++) {
      for (const r of this.colliders) {
        const cx = THREE.MathUtils.clamp(p.x, r.x0, r.x1), cz = THREE.MathUtils.clamp(p.z, r.z0, r.z1);
        const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
        if (d2 < RADIUS * RADIUS) {
          if (d2 < 1e-10) { // 中心已经在矩形里：沿最短方向推出
            const pushes = [[r.x0 - RADIUS - p.x, 0], [r.x1 + RADIUS - p.x, 0], [0, r.z0 - RADIUS - p.z], [0, r.z1 + RADIUS - p.z]];
            pushes.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
            p.x += pushes[0][0]; p.z += pushes[0][1];
          } else { const d = Math.sqrt(d2); p.x += dx / d * (RADIUS - d); p.z += dz / d * (RADIUS - d); }
        }
      }
      for (const o of this.obstacles()) {
        const c = Math.cos(o.rot), s = Math.sin(o.rot);
        const lx = (p.x - o.x) * c - (p.z - o.z) * s, lz = (p.x - o.x) * s + (p.z - o.z) * c;
        const qx = THREE.MathUtils.clamp(lx, -o.hx, o.hx), qz = THREE.MathUtils.clamp(lz, -o.hz, o.hz);
        let dx = lx - qx, dz = lz - qz, d = Math.hypot(dx, dz);
        if (d < RADIUS) {
          if (d < 1e-6) { // 已经在家具内部：沿最近的边推出
            const ex = o.hx - Math.abs(lx), ez = o.hz - Math.abs(lz);
            const px = ex < ez ? (Math.sign(lx) || 1) * (ex + RADIUS) : 0, pz = ex < ez ? 0 : (Math.sign(lz) || 1) * (ez + RADIUS);
            p.x += px * c + pz * s; p.z += -px * s + pz * c;
          }
          else { const push = RADIUS - d; const wx = dx / d * push, wz = dz / d * push; p.x += wx * c + wz * s; p.z += -wx * s + wz * c; }
        }
      }
    }
    const R = 38; const rr = Math.hypot(p.x, p.z); if (rr > R) { p.x *= R / rr; p.z *= R / rr; }
  }
  tryMove(dx, dz) {
    const p = { x: this.pos.x + dx, z: this.pos.z + dz };
    this.resolve(p);
    this.pos.x = p.x; this.pos.z = p.z;
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const run = k.has('shift') ? 2.1 : 1;
    let fx = 0, fz = 0;
    if (k.has('w') || k.has('arrowup')) fz += 1;
    if (k.has('s') || k.has('arrowdown')) fz -= 1;
    if (k.has('a')) fx -= 1;
    if (k.has('d')) fx += 1;
    if (k.has('arrowleft')) this.yaw += dt * 1.8;
    if (k.has('arrowright')) this.yaw -= dt * 1.8;
    if (this.joy) { fx += this.joy.x; fz += -this.joy.y; }
    const f = this.forward().clone(), r = new THREE.Vector3(-f.z, 0, f.x);
    const want = new THREE.Vector3().addScaledVector(f, fz).addScaledVector(r, fx);
    if (this.goal) {
      const to = new THREE.Vector3(this.goal.x - this.pos.x, 0, this.goal.y - this.pos.z);
      const d = to.length();
      if (d < 0.15) this.goal = null;
      else {
        want.copy(to.normalize()).multiplyScalar(Math.min(1, d));
        // 走的同时把视线转向目标
        const targetYaw = Math.atan2(-to.x, -to.z);
        let dy = targetYaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        this.yaw += dy * Math.min(1, dt * 4);
      }
    }
    if (want.lengthSq() > 1) want.normalize();
    const speed = 2.3 * run;
    this.vel.lerp(want.multiplyScalar(speed), Math.min(1, dt * 9));
    const before = this.pos.clone();
    this.tryMove(this.vel.x * dt, this.vel.z * dt);
    if (this.goal && before.distanceTo(this.pos) < this.vel.length() * dt * 0.2) this.goal = null; // 被挡住就停
    const moved = before.distanceTo(this.pos);
    this.bob += moved * 7;
    const fy = this.floorHeight(this.pos.x, this.pos.z);
    this.footY += (fy - this.footY) * Math.min(1, dt * 10);
    const c = this.camera;
    c.position.set(this.pos.x, this.footY + EYE + Math.sin(this.bob) * 0.018, this.pos.z);
    c.rotation.order = 'YXZ';
    c.rotation.set(this.pitch, this.yaw, 0);
  }

  // 触屏摇杆
  buildJoystick() {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const el = document.createElement('div');
    el.className = 'joystick'; el.innerHTML = '<i></i>';
    document.body.appendChild(el);
    const knob = el.firstChild;
    let id = null, cx = 0, cy = 0;
    el.addEventListener('pointerdown', e => { id = e.pointerId; const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; el.setPointerCapture(id); e.stopPropagation(); });
    el.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      let x = (e.clientX - cx) / 45, y = (e.clientY - cy) / 45; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
      this.joy = { x, y }; knob.style.transform = `translate(${x * 30}px, ${y * 30}px)`;
    });
    const up = () => { id = null; this.joy = null; knob.style.transform = ''; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    this.joyEl = el;
  }
}

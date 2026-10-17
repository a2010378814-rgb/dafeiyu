// 开发用模型查看器：检查 VRM 在 three-vrm 下的真实渲染效果。
// URL 参数：?view=front|side|back|face|q34&pose=rest|relaxed&ui=0&expr=happy
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(params.get('bg') || '#ffffff');

// MToon 下方向光强度 π 相当于"原色"；环境光会被叠加到 GI 上，过强会整体发白
const light = new THREE.DirectionalLight(0xffffff, Math.PI);
light.position.set(0.6, 1.4, 1.2);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, Number(params.get('ambient') ?? 0.0)));
// spring=0 时关闭弹簧骨骼，便于检查静止形状
const springOn = params.get('spring') !== '0';

// VRM 1.0 模型面朝 +Z；正交相机，方便和三视图对比
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
const VIEWS = {
  front: { pos: [0, 0.53, 3], target: [0, 0.53, 0], height: 1.17 },
  // 和参考三视图一致：看角色左侧，脸朝画面左
  side: { pos: [3, 0.53, 0], target: [0, 0.53, 0], height: 1.17 },
  back: { pos: [0, 0.53, -3], target: [0, 0.53, 0], height: 1.17 },
  face: { pos: [0, 0.80, 3], target: [0, 0.80, 0], height: 0.42 },
  q34: { pos: [-1.72, 0.62, 2.46], target: [0, 0.55, 0], height: 1.05 },
  high: { pos: [0, 1.9, 2.6], target: [0, 0.5, 0], height: 1.25 },
};
let currentView = params.get('view') || 'front';

function applyView(name) {
  currentView = name;
  const v = VIEWS[name];
  const aspect = canvas.clientWidth / canvas.clientHeight;
  camera.top = v.height / 2;
  camera.bottom = -v.height / 2;
  camera.left = (-v.height / 2) * aspect;
  camera.right = (v.height / 2) * aspect;
  camera.position.set(...v.pos);
  camera.lookAt(new THREE.Vector3(...v.target));
  camera.updateProjectionMatrix();
  highlight('views', name);
}

function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  applyView(currentView);
}
window.addEventListener('resize', resize);

let vrm = null;
let pose = params.get('pose') || 'relaxed';

function applyPose(name) {
  pose = name;
  if (!vrm) return;
  const h = vrm.humanoid;
  for (const b of ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand']) {
    h.getNormalizedBoneNode(b)?.rotation.set(0, 0, 0);
  }
  if (name === 'relaxed') {
    // 参考图的站姿：手臂下垂、略向外张
    h.getNormalizedBoneNode('leftUpperArm').rotation.z = -1.12;
    h.getNormalizedBoneNode('rightUpperArm').rotation.z = 1.12;
    h.getNormalizedBoneNode('leftLowerArm').rotation.z = -0.12;
    h.getNormalizedBoneNode('rightLowerArm').rotation.z = 0.12;
  }
  highlight('poses', name);
}

let expr = params.get('expr') || 'neutral';
function applyExpression(name) {
  expr = name;
  if (!vrm) return;
  const em = vrm.expressionManager;
  for (const e of em.expressions) em.setValue(e.expressionName, 0);
  if (name !== 'neutral') em.setValue(name, 1);
  highlight('exprs', name);
}

function highlight(group, name) {
  for (const b of document.querySelectorAll(`#${group} button`)) b.classList.toggle('on', b.dataset.name === name);
}

function buttons(group, names, fn) {
  const el = document.getElementById(group);
  for (const n of names) {
    const b = document.createElement('button');
    b.textContent = n;
    b.dataset.name = n;
    b.onclick = () => fn(n);
    el.appendChild(b);
  }
}
buttons('views', Object.keys(VIEWS), applyView);
buttons('poses', ['relaxed', 'rest'], applyPose);
buttons('exprs', ['neutral', 'blink', 'happy', 'relaxed', 'surprised', 'sad', 'aa', 'ih', 'ou', 'ee', 'oh',
  'lookLeft', 'lookRight', 'lookUp', 'lookDown'], applyExpression);
if (params.get('ui') === '0') document.getElementById('ui').classList.add('hidden');

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));
const url = params.get('model') || '/models/claude-whale.vrm';
loader.load(url, (gltf) => {
  vrm = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.combineSkeletons(gltf.scene);
  scene.add(vrm.scene);
  applyPose(pose);
  applyExpression(expr);
  const s = document.getElementById('status');
  s.textContent = `已加载：${vrm.meta?.name ?? ''}  表情 ${vrm.expressionManager.expressions.length} 个，`
    + `弹簧骨骼 ${vrm.springBoneManager?.joints.size ?? 0} 个`;
  window.__ready = true;
}, undefined, (err) => {
  document.getElementById('status').textContent = '加载失败：' + err;
  console.error(err);
});

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (vrm) {
    if (springOn) {
      vrm.update(dt);
    } else {
      vrm.humanoid.update();
      vrm.expressionManager?.update();
      vrm.lookAt?.update(dt);
      // MToon 的 alphaTest 等 uniform 只在 material.update() 里同步，跳过会导致透明裁切失效
      vrm.materials?.forEach((m) => m.update?.(dt));
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
resize();
tick();

// 供自动化检查调用
window.viewer = {
  applyView, applyPose, applyExpression, renderer, scene, camera, THREE,
  get vrm() { return vrm; },
  // 页面在后台时 requestAnimationFrame 不运行，自动化检查用它手动渲染一帧
  renderOnce() {
    if (vrm) {
      vrm.humanoid.update();
      vrm.expressionManager?.update();
      vrm.materials?.forEach((m) => m.update?.(0));
    }
    renderer.render(scene, camera);
  },
  // 读取画面上某个归一化坐标 (0..1, 左上为原点) 的像素颜色
  pixel(x, y) {
    const gl = renderer.getContext();
    const d = new Uint8Array(4);
    gl.readPixels(Math.round(x * canvas.width), Math.round((1 - y) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, d);
    return [d[0], d[1], d[2]];
  },
};

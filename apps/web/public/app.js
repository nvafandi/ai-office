import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const API = "/api";
let scene, camera, renderer, controls, raycaster, pointer;
let floorObjects = [];
let labels = [];
let selectedFloorId = null;

const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const subtitleEl = document.getElementById("subtitle");

async function fetchJSON(path) {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0c10);
  scene.fog = new THREE.Fog(0x0b0c10, 10, 60);

  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
  camera.position.set(18, 14, 22);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvas.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // grid
  const grid = new THREE.GridHelper(40, 40, 0x23303a, 0x11151b);
  scene.add(grid);

  // axes
  scene.add(new THREE.AxesHelper(5));

  // lighting
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0x4fc3f7, 0.8);
  dir.position.set(10, 20, 10);
  scene.add(dir);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();

  window.addEventListener("resize", onResize);
  window.addEventListener("pointerdown", onPointerDown);
}

function createFloorMesh(index, x, z, name) {
  const group = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x161d25, roughness: 0.8 })
  );
  base.position.y = 0.3;
  base.userData = { floorId: name, type: "floor-base" };
  group.add(base);

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(7.2, 0.1, 7.2),
    new THREE.MeshStandardMaterial({ color: 0x45a29e, emissive: 0x082020, emissiveIntensity: 0.5 })
  );
  top.position.y = 0.65;
  top.userData = { floorId: name, type: "floor-top" };
  group.add(top);

  // windows
  const winMat = new THREE.MeshStandardMaterial({ color: 0x3aa0c9, emissive: 0x1a3a4a, emissiveIntensity: 0.6 });
  const sides = [
    { pos: [3.65, 0.7, 0], rot: [0, Math.PI / 2, 0], size: [0.1, 0.9, 0.9] },
    { pos: [-3.65, 0.7, 0], rot: [0, -Math.PI / 2, 0], size: [0.1, 0.9, 0.9] },
    { pos: [0, 0.7, 3.65], size: [0.9, 0.9, 0.1] },
    { pos: [0, 0.7, -3.65], rot: [0, Math.PI, 0], size: [0.9, 0.9, 0.1] },
  ];
  sides.forEach((s) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(...s.size), winMat);
    w.position.set(...s.pos);
    if (s.rot) w.rotation.set(...s.rot);
    w.userData = { floorId: name, type: "window" };
    group.add(w);
  });

  group.position.set(x, 0, z);
  group.userData = { floorId: name, index };
  scene.add(group);
  floorObjects.push(group);
  return group;
}

function placeFloors(floors) {
  // clear previous
  floorObjects.forEach((o) => scene.remove(o));
  floorObjects = [];
  labels.forEach((l) => l.remove());
  labels = [];

  const cols = 4;
  floors.forEach((f, i) => {
    const x = (i % cols - (cols - 1) / 2) * 10;
    const z = Math.floor(i / cols) * 10;
    createFloorMesh(i, x, z, f.id);
    addLabel(f.name || f.id, x, 2.6, z, f.id);
  });

  subtitleEl.textContent = `${floors.length} floor dari API`;
  statusEl.textContent = "3D Office siap";
}

function addLabel(text, x, y, z, floorId) {
  const el = document.createElement("div");
  el.className = "floor-label";
  el.textContent = text;
  el.dataset.floorId = floorId;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    selectFloor(floorId);
  });
  canvas.appendChild(el);
  labels.push({ el, floorId, x, y, z });
}

function selectFloor(floorId) {
  selectedFloorId = floorId;
  floorObjects.forEach((o) => {
    const active = o.userData.floorId === floorId;
    o.traverse((c) => {
      if (c.isMesh) {
        c.material.emissive.setHex(active ? 0x1a4a3a : c.userData.type === "window" ? 0x1a3a4a : 0);
        c.material.emissiveIntensity = active ? 0.8 : 0.6;
      }
    });
  });
  labels.forEach((l) => {
    l.el.classList.toggle("active", l.floorId === floorId);
  });
  statusEl.textContent = `selected: ${floorId}`;
}

async function load() {
  try {
    const floors = await fetchJSON("/floors");
    if (!floors.length) {
      // seed demo floor so scene is not empty
        placeFloors([{ id: "demo_1", name: "Demo Floor" }]);
    } else {
      placeFloors(floors);
    }
  } catch (err) {
    statusEl.textContent = "API tidak tersedia — demo saja";
    placeFloors([{ id: "demo_1", name: "Demo Floor" }]);
  }
}

function onResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function onPointerDown(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(floorObjects, true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && !obj.userData.floorId) obj = obj.parent;
    if (obj) selectFloor(obj.userData.floorId);
  }
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

init();
load();
animate();

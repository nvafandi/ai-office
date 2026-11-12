import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const API = "/api";
let scene, camera, renderer, controls, raycaster, pointer;
let floorObjects = [];
let labels = [];
const proj = new THREE.Vector3();
let selectedFloorId = null;
let pendingFloorId = null;
const floorCache = new Map();

const canvas = document.getElementById("canvas");
const statusEl = document.getElementById("status");
const subtitleEl = document.getElementById("subtitle");

const noticesList = document.getElementById("notices-list");
const noticesForm = document.getElementById("notices-form");
const noticesMsg = document.getElementById("notices-msg");
const noticeTitle = document.getElementById("notice-title");
const noticeContent = document.getElementById("notice-content");
const noticeAuthor = document.getElementById("notice-author");

const panelEl = document.getElementById("notices-panel");
const panelClose = document.getElementById("panel-close");
const tabNotices = document.getElementById("tab-notices");
const tabWall = document.getElementById("tab-wall");
const tabAgents = document.getElementById("tab-agents");
const noticesBoard = document.getElementById("notices-board");
const wallBoard = document.getElementById("wall-board");
const agentLive = document.getElementById("agent-live");
const wallList = document.getElementById("wall-list");
const agentList = document.getElementById("agent-list");

function setMsg(text, kind) {
  noticesMsg.textContent = text || "";
  const ok = "bg-[#1a4a3a] text-[#6ee7b7] border border-[#45a29e]";
  const err = "bg-[#4a1a1a] text-[#fca5a5] border border-[#7f1d1d]";
  noticesMsg.className = "msg p-2 text-xs rounded-sm " + (text ? "block " + (kind === "ok" ? ok : err) : "hidden");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function fetchNotices() {
  try {
    const notices = await fetchJSON("/notices");
    renderNotices(notices);
    setMsg("", "");
  } catch (err) {
    setMsg("Gagal muat notice: " + err.message, "err");
  }
}

function renderNotices(notices) {
  noticesList.innerHTML = "";
  (notices || []).forEach((n) => {
    const el = document.createElement("div");
    el.className = "bg-[#161d25] border border-[#23303a] rounded-[6px] p-[0.6rem] text-[0.85rem] mb-[0.6rem]";
    el.innerHTML = `
      <div class="text-[#fff] font-semibold mb-[0.25rem]">${escapeHtml(n.title)}</div>
      <div class="text-[#c5c6c7] mb-[0.35rem] whitespace-pre-wrap">${escapeHtml(n.content)}</div>
      <div class="text-[#889097] text-[0.7rem] mb-[0.35rem]">${escapeHtml(n.author)} • ${n.createdAt ? new Date(n.createdAt).toLocaleString("id-ID") : "-"}</div>
      <button class="bg-transparent border border-[#45a29e] text-[#4fc3f7] px-[0.4rem] py-[0.15rem] rounded-[3px] text-[0.7rem] cursor-pointer" type="button">hapus</button>
    `;
    el.querySelector("button[type=button]").addEventListener("click", () => deleteNotice(n.id));
    noticesList.appendChild(el);
  });
}

async function createNotice(e) {
  e.preventDefault();
  if (!selectedFloorId) {
    setMsg("Pilih floor terlebih dahulu", "err");
    return;
  }
  const floorId = selectedFloorId;
  try {
    await fetchJSON("/notices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        floor_id: floorId,
        title: noticeTitle.value,
        content: noticeContent.value,
        author: noticeAuthor.value,
      }),
    });
    noticeTitle.value = "";
    noticeContent.value = "";
    noticeAuthor.value = "";
    setMsg("Notice dibuat", "ok");
    await fetchNotices();
  } catch (err) {
    setMsg("Gagal buat notice: " + err.message, "err");
  }
}

async function deleteNotice(id) {
  try {
    await fetchJSON(`/notices/${id}`, { method: "DELETE" });
    setMsg("Notice dihapus", "ok");
    await fetchNotices();
  } catch (err) {
    setMsg("Gagal hapus notice: " + err.message, "err");
  }
}

noticesForm.addEventListener("submit", createNotice);

panelClose.addEventListener("click", () => {
  panelEl.classList.add("hidden");
});
tabNotices.addEventListener("click", () => setTab("notices"));
tabWall.addEventListener("click", () => setTab("wall"));
tabAgents.addEventListener("click", () => setTab("agents"));

async function fetchJSON(path, opts) {
  const r = await fetch(`${API}${path}`, opts);
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
  el.className = "absolute z-10 bg-[#0b0c10]/85 border border-[#45a29e] text-[#4fc3f7] px-[0.6rem] py-[0.35rem] rounded-[4px] text-[0.8rem] cursor-pointer select-none whitespace-nowrap pointer-events-auto [&.active]:text-[#fff] [&.active]:border-[#4fc3f7]";
  el.textContent = text;
  el.dataset.floorId = floorId;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    selectFloor(floorId);
  });
  canvas.appendChild(el);
  labels.push({ el, floorId, x, y, z });
}

function projectLabel() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  labels.forEach((l) => {
    const group = floorObjects.find((o) => o.userData.floorId === l.floorId);
    if (!group) {
      l.el.style.display = "none";
      return;
    }
    proj.set(l.x, l.y, l.z).project(camera);
    if (proj.z < -1 || proj.z > 1 || proj.x < -1 || proj.x > 1 || proj.y < -1 || proj.y > 1) {
      l.el.style.display = "none";
      return;
    }
    l.el.style.display = "";
    l.el.style.left = (proj.x * 0.5 + 0.5) * w + "px";
    l.el.style.top = (-(proj.y * 0.5) + 0.5) * h + "px";
  });
}

function setTab(tabId) {
  tabNotices.classList.toggle("active", tabId === "notices");
  tabWall.classList.toggle("active", tabId === "wall");
  tabAgents.classList.toggle("active", tabId === "agents");
  noticesBoard.classList.toggle("hidden", tabId !== "notices");
  wallBoard.classList.toggle("hidden", tabId !== "wall");
  agentLive.classList.toggle("hidden", tabId !== "agents");
}

function renderWall(issues) {
  wallList.innerHTML = "";
  (issues || []).forEach((it) => {
    const el = document.createElement("div");
    el.className = "bg-[#161d25] border border-[#23303a] rounded-[6px] p-[0.6rem] text-[0.85rem] mb-[0.6rem]";
    el.innerHTML = `
      <div class="text-[#fff] font-semibold mb-[0.25rem]">#${escapeHtml(it.number)} ${escapeHtml(it.title)}</div>
      <div class="text-[#c5c6c7] text-[0.7rem]">stage: ${escapeHtml(it.stage)} • assignee: ${escapeHtml(it.assignee_id ?? "-")}</div>
    `;
    wallList.appendChild(el);
  });
}

function renderAgents(agents) {
  agentList.innerHTML = "";
  (agents || []).forEach((a) => {
    const el = document.createElement("div");
    el.className = "bg-[#161d25] border border-[#23303a] rounded-[6px] p-[0.6rem] text-[0.85rem] mb-[0.6rem]";
    el.innerHTML = `
      <div class="text-[#fff] font-semibold mb-[0.25rem]">${escapeHtml(a.name)}</div>
      <div class="text-[#c5c6c7] text-[0.7rem]">${escapeHtml(a.role)} • ${escapeHtml(a.stage)}</div>
      <div class="text-[#889097] text-[0.7rem]">model: ${escapeHtml(a.model)} • ${a.tokens_used ?? 0}/${a.token_cap ?? 0}</div>
    `;
    agentList.appendChild(el);
  });
}

async function loadFloorData(floorId) {
  pendingFloorId = floorId;
  const cached = floorCache.get(floorId);
  if (cached) {
    renderWall(cached.issues);
    renderAgents(cached.agents);
    setMsg("", "");
    return;
  }
  try {
    const [issues, agents] = await Promise.all([
      fetchJSON(`/issues?floorId=${encodeURIComponent(floorId)}`),
      fetchJSON(`/agents?floorId=${encodeURIComponent(floorId)}`),
    ]);
    if (pendingFloorId !== floorId) return;
    floorCache.set(floorId, { issues, agents });
    renderWall(issues);
    renderAgents(agents);
    setMsg("", "");
  } catch (err) {
    setMsg("Gagal muat wall/agent: " + err.message, "err");
  }
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
  panelEl.classList.remove("hidden");
  setMsg("", "");
  setTab("wall");
  loadFloorData(floorId);
}

async function load() {
  try {
    const floors = await fetchJSON("/floors");
    placeFloors(floors);
  } catch (err) {
    statusEl.textContent = "API tidak tersedia";
    placeFloors([]);
  }
  await fetchNotices();
}

function onResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  projectLabel();
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
  projectLabel();
  renderer.render(scene, camera);
}

init();
load();
animate();

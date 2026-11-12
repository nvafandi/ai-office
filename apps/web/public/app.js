const API = "/api";
const statusEl = document.getElementById("status");
const floorsBody = document.getElementById("floorsBody");
const floorsEmpty = document.getElementById("floorsEmpty");
const floorsTable = document.getElementById("floorsTable");
const floorSelect = document.getElementById("floorSelect");
const issuesBody = document.getElementById("issuesBody");
const issuesEmpty = document.getElementById("issuesEmpty");
const issuesTable = document.getElementById("issuesTable");
const floorForm = document.getElementById("floorForm");

async function fetchJSON(path, opts = {}) {
  const r = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function html(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
}

function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function loadFloors() {
  const floors = await fetchJSON("/floors");
  floorsBody.innerHTML = "";
  floorSelect.innerHTML = '<option value="">-- pilih floor --</option>';
  if (!floors.length) {
    floorsEmpty.style.display = "";
    floorsTable.style.display = "none";
    return;
  }
  floorsEmpty.style.display = "none";
  floorsTable.style.display = "";
  for (const f of floors) {
    floorsBody.insertAdjacentHTML(
      "beforeend",
      html`<tr><td>${escape(f.name)}</td><td>${escape(f.repo)}</td><td><span class="badge">${escape(f.status)}</span></td><td>${new Date(f.created_at).toLocaleString()}</td></tr>`
    );
    floorSelect.insertAdjacentHTML("beforeend", html`<option value="${escape(f.id)}">${escape(f.name)}</option>`);
  }
}

async function loadIssues(floorId) {
  issuesBody.innerHTML = "";
  if (!floorId) {
    issuesEmpty.style.display = "none";
    issuesTable.style.display = "none";
    return;
  }
  const issues = await fetchJSON(`/issues?floorId=${encodeURIComponent(floorId)}`);
  if (!issues.length) {
    issuesEmpty.style.display = "";
    issuesTable.style.display = "none";
    return;
  }
  issuesEmpty.style.display = "none";
  issuesTable.style.display = "";
  for (const it of issues) {
    issuesBody.insertAdjacentHTML(
      "beforeend",
      html`<tr><td>${it.number}</td><td>${escape(it.title)}</td><td><span class="badge">${escape(it.stage)}</span></td><td>${escape(it.assignee_id ?? "-")}</td></tr>`
    );
  }
}

floorSelect.addEventListener("change", (e) => loadIssues(e.target.value));

floorForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("floorName").value.trim();
  const repo = document.getElementById("floorRepo").value.trim();
  if (!name) return;
  await fetchJSON("/floors", { method: "POST", body: JSON.stringify({ name, repo }) });
  document.getElementById("floorName").value = "";
  await loadFloors();
});

(async () => {
  try {
    await fetchJSON("/health");
    statusEl.textContent = "terhubung ke API";
    statusEl.style.color = "#4fc3f7";
    await loadFloors();
  } catch (err) {
    statusEl.textContent = "API tidak tersedia";
    statusEl.style.color = "#ff6b6b";
    console.error(err);
  }
})();

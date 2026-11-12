# Rencana Rewrite AI Office (Node.js)

Sumber: https://github.com/adrianeyre/ai-office — 3D office di mana agen AI mengerjakan isu GitHub. Repo asli sudah Node.js. Ini rencana reimplementasi penuh di folder `ai-office/`.

## 1. Cakupan (rewrite semua)
- **apps/server**: API REST (`/api`), AI Gateway (`/v1`), AI Accounts, token caps. Selesai: health, floors, agents, issues, gateway accounts + chat completions.
- **apps/web**: Web app + 3D Office (Three.js), floor view, agent live view, whiteboard, notice board, wall board. Dalam progres: 3D Office test UI.
- **packages/shared**: tipe, skema zod, utilitas lintas paket. Selesai.
- **packages/db**: SQLite lokal via `sql.js` (tanpa Docker/Postgres), skema + migrasi + seed. Selesai.
- **packages/events**: event bus. Belum.
- **packages/github**: GitHub App client, intake isu. Belum.
- **packages/orchestrator**: manager, pipeline isu, sandbox lokal, watchdog. Belum.
- **packages/communications**: Notice Board, integrasi pihak ketiga. Belum.

## 2. Stack (tidak menambah dependensi baru kecuali wajib)
- Node >= 20, npm >= 10 (monorepo via root node_modules + npm link).
- TypeScript (strict, ESM), tsx untuk dev.
- SQLite file lokal via `sql.js` — tidak ada server DB, tidak ada Docker.
- Three.js untuk 3D Office (dependensi baru, wajib untuk 3D).
- Vitest + Vite (web), ESLint + Prettier.
- `npm run dev` nyalakan server; `npm run build` bangun semua paket.

## 3. Status saat ini (selesai)
- Monorepo npm, tsconfig, ESLint/Prettier siap.
- `packages/shared`: tipe (Floor, Agent, Issue, Memory, AIAccount), skema zod, util. Build OK.
- `packages/db`: SQLite lokal via `sql.js`, skema + migrasi + seed. Build OK.
- `apps/server`: HTTP `:3045`, API `/api/health`, `/api/floors` (GET/POST), `/api/agents`, `/api/issues`, gateway `/api/gateway/accounts`, `/v1/accounts`, `/v1/chat/completions`. Melayani UI statis. Build OK + diuji runtime.
- `apps/web`: halaman HTML + JS sederhana (daftar floor/issue). Sudah berjalan di server.

## 4. Target berikutnya (3D Office test UI)
- Tambah `three` ke root `package.json`.
- Ganti `apps/web/public/index.html` + `app.js` dengan scene 3D: gedung kantor sederhana, lantai (floor) bisa diklik, kamera orbit, grid, lighting.
- UI menampilkan daftar floor dari `/api/floors` sebagai label di atas canvas.
- `npm run build` + server nyala, buka `http://localhost:3045`, scene 3D tertampil tanpa error.

## 5. Milestone & keluar
- M1 (selesai): monorepo npm, shared, db, SQLite lokal tanpa Docker.
- M2 (selesai): server `:3045`, API floors/agents/issues + gateway, build lolos.
- M3 (selesai): web UI menampilkan floor + issue dari API.
- M4 (ini): 3D Office test UI (Three.js) berjalan di browser via server `:3045`.
- M5: `npm run build && npm run test && npm run typecheck` lolos.

## 6. Risiko
- Three.js via CDN ESM di browser — pastikan impor berjalan di server statis Node.
- AI non-deterministik + sandbox agen di-mock di MVP.

Skips (YAGNI, tambah bila diminta): multi-region, plugin agen pihak ketiga, mobile native, AI fine-tuning.

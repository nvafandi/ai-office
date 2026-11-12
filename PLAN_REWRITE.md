# Rencana Rewrite AI Office (Node.js)

Sumber: https://github.com/adrianeyre/ai-office — 3D office di mana agen AI mengerjakan isu GitHub. Repo asli sudah Node.js. Ini rencana reimplementasi penuh di folder `ai-office/`.

## 1. Cakupan (rewrite semua)
- **apps/server**: API REST (`/api`), AI Gateway (`/v1`), AI Accounts, token caps. Selesai: health, floors, agents, issues, gateway accounts + chat completions (mock). Referensi upstream `packages/gateway` (AI Gateway lengkap: load balancing, providers, accounts, usage, pricing, models) **belum diimplementasi** di rewrite ini.
- **apps/web**: Web app + 3D Office (Three.js), floor view, notice board. Upstream React memiliki komponen tambahan: notice-board (live via event stream + dismiss + aksi), whiteboard, wall-board, agent-live-view, agent-chat, connections. **Belum diimplementasi** di rewrite ini (vanilla JS, sederhana).
- **packages/shared**: tipe, skema zod, utilitas lintas paket. Selesai.
- **packages/db**: SQLite lokal via `sql.js` (tanpa Docker/Postgres), skema + migrasi + seed. Selesai.
- **packages/events**: event bus. Selesai (EventBus typed, subscribe/unsubscribe/publish, diintegrasikan ke orchestrator + server).
- **packages/github**: GitHub App client, intake isu. Selesai (OAuth URL + code exchange, AES-256-GCM token enkripsi, HMAC webhook verify, installations, intakeFromGitHub).
- **packages/orchestrator**: manager, pipeline isu, sandbox lokal, watchdog. Selesai (pipeline stage + assign/advance/history + runner sandbox + watchdog idle).
- **packages/communications**: Notice Board, integrasi pihak ketiga. Selesai (tabel notices, GET/POST/DELETE /api/notices, ConnectionManager 8 provider mock, GET /api/connections + POST /api/connections/:id/send).

## 7. Referensi upstream (project\ai-office v1.8.0)
Repo asli `adrianeyre/ai-office` di `C:\Users\nurvan\Documents\project\ai-office` (Docker, pnpm workspaces, drizzle-orm, React + Tailwind) digunakan sebagai rujukan fitur, bukan ditiru stack-nya. Temuan UI yang relevan untuk rencana lanjut:
- `packages/gateway`: AI Gateway lengkap (belum ada di rewrite).
- `apps/web/src/notice-board.tsx`: Notice Board 2D live via event stream, dismiss, aksi (PRD FR-48, FR-50).
- `apps/web/src/wall-board.ts`: Wall Board per lantai (isu antrian, token vs cap, kesehatan lantai) (PRD FR-50, FR-57).
- `apps/web/src/agent-live-view.tsx`: Aktivitas live agen (terminal, tool call, file, model call) (PRD FR-58).
- `apps/web/src/whiteboard.tsx`: Whiteboard perencanaan batch.
Rewrite ini sengaja stack lebih ringan; komponen di atas adalah kandidat fase berikutnya bila diminta.

## 2. Stack (tidak menambah dependensi baru kecuali wajib)
- Node >= 26, npm >= 12 (monorepo via root node_modules + npm link).
- TypeScript (strict, ESM), tsx untuk dev.
- SQLite file lokal via `sql.js` — tidak ada server DB, tidak ada Docker.
- Three.js untuk 3D Office (dependensi baru, wajib untuk 3D).
- Vitest + Vite (web), ESLint + Prettier.
- `npm run dev` nyalakan server; `npm run build` bangun semua paket.
- **UI web:** vanilla JS + Tailwind CSS v4 (build-time, static CSS, 0 biaya runtime) di `apps/web/public/styles/tailwind.css` yang dibangun dari `input.css` via `npm run build:css`. CSS internal di `index.html` diganti dengan utility Tailwind. Responsivitas via `@media (max-width: 768px)` di `input.css`: panel kanan (`#notices-panel`, lebar 320px) menumpuk di bawah canvas saat layar kecil. Tidak menambah dependensi selain `tailwindcss`, tidak ada Vite dev server production.

## 3. Status saat ini (selesai)
- Monorepo npm, tsconfig, ESLint/Prettier siap.
- `packages/shared`: tipe (Floor, Agent, Issue, Memory, AIAccount), skema zod, util. Build OK.
- `packages/db`: SQLite lokal via `sql.js`, skema + migrasi + seed. Build OK.
- `apps/server`: HTTP `:3045`, API `/api/health`, `/api/floors` (GET/POST), `/api/agents` (GET/POST), `/api/issues` (GET/POST), gateway `/api/gateway/accounts`, `/v1/chat/completions` (mock), orchestrator `/api/issues/:id/assign|advance|history`, notices `/api/notices` (GET/POST/DELETE), connections `/api/connections` (+`/:id/send`), GitHub `/api/github/*`. Melayani UI statis + aset Three.js. Build OK + diuji runtime.
- `apps/web`: halaman HTML + JS sederhana (daftar floor/issue via Three.js). Sudah ditambah **Notice Board panel kanan** (daftar/buat/hapus notice dari `/api/notices`). Sudah berjalan di server.

## 4. Target berikutnya (3D Office test UI)
- Tambah `three` ke root `package.json`.
- Ganti `apps/web/public/index.html` + `app.js` dengan scene 3D: gedung kantor sederhana, lantai (floor) bisa diklik, kamera orbit, grid, lighting.
- UI menampilkan daftar floor dari `/api/floors` sebagai label di atas canvas.
- `npm run build` + server nyala, buka `http://localhost:3045`, scene 3D tertampil tanpa error.

## 5. Milestone & keluar
- M1 (selesai): monorepo npm, shared, db, SQLite lokal tanpa Docker.
- M2 (selesai): server `:3045`, API floors/agents/issues + gateway, build lolos.
- M3 (selesai): web UI menampilkan floor + issue dari API.
- M4 (selesai): 3D Office test UI (Three.js) berjalan di browser via server `:3045`.
- M5 (selesai): `npm run build && npm run test` lolos (build + 43 test).
- M6 (selesai): Communications — Notice Board UI + backend, GitHub App live OAuth + token (simulasi tanpa kredensial nyata), event bus, orchestrator pipeline.

Sisa opsional (kandidat fase berikutnya, rujukan upstream): paket `packages/gateway` (AI Gateway lengkap), whiteboard, wall board, agent live view di 3D, GitHub App live production (butuh kredensial GitHub asli), deploy production.

## 6. Risiko
- Three.js via CDN ESM di browser — pastikan impor berjalan di server statis Node.
- AI non-deterministik + sandbox agen di-mock di MVP.

Skips (YAGNI, tambah bila diminta): multi-region, plugin agen pihak ketiga, mobile native, AI fine-tuning.

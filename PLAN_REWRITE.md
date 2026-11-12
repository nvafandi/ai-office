# Rencana Rewrite AI Office (Node.js)

Sumber: https://github.com/adrianeyre/ai-office — 3D office di mana agen AI mengerjakan isu GitHub. Repo asli sudah Node.js (Node 26, pnpm 12, TS 6, Postgres, Docker). Ini rencana reimplementasi penuh di folder `ai-office/`.

## 1. Cakupan (rewrite semua)
- **apps/server**: API REST (`/api`), AI Gateway (`/v1`), Gateway Keys, AI Accounts, token caps, analytics, request history, outbound proxy, Decision Model, AI Providers.
- **apps/web**: Web app + 3D Office (Three.js-ish), floor view, agent live view, whiteboard, notice board, wall board, accessibility.
- **packages/shared**: tipe, schema, utilitas lintas paket.
- **packages/db**: schema SQLite, migrasi, akses data (floors, agen, isu, memori, batch, rencana).
- **packages/events**: event bus (aktivitas, GitHub events).
- **packages/github**: GitHub App client, intake isu, PR, webhook, branch protection, label.
- **packages/orchestrator**: manager, pipeline isu (needs-work → review → QA → docs → ready-to-merge), sandboxes (Sandcastle), watchdog, kickoff/wrap-up.
- **packages/communications**: Notice Board, browser notif, koneksi (Confluence, Notion, Google Docs/Slides/Drive/Sheets/Calendar, Slack), laporan wrap-up.
- **templates**: floor templates bawaan + custom owner template.
- **site**: website dokumentasi + build.
- **e2e + test**: unit, integrasi, e2e, screenshot.

## 2. Stack (tidak menambah dependensi baru kecuali wajib)
- Node >= 20, pnpm >= 8 (workspace monorepo; dev pakai Node 24 / pnpm 10 yang tersedia).
- TypeScript (strict, ESM), tsx untuk dev.
- SQLite (file lokal, `better-sqlite3`) untuk semua penyimpanan — tidak ada server database, tidak ada Docker.
- Vitest + Vite (web), ESLint + Prettier.
- Dev hanya `pnpm dev` (server + web), tanpa `docker compose`.

## 3. Pemetaan modul (satu paket = satu tanggung jawab)
| Paket | Tanggung jawab inti |
|---|---|
| shared | tipe, zod schema, konstanta, util |
| db | SQLite client (`better-sqlite3`), tabel, migrasi, repo query, file `.sqlite` lokal |
| events | bus, publisher/subscriber, activity feed |
| github | Octokit wrapper, app auth, webhook verifikasi, intake |
| orchestrator | floor/manager/agen, stage pipeline, sandbox run, watchdog |
| gateway | /v1, load balancer AI, token cap, kunci gateway, riwayat |
| communications | notice, notif, integrasi pihak ketiga (Google dll), wall board |

## 4. Fase pekerjaan
1. **Pondok**: workspace pnpm, tsconfig, ESLint/Prettier, SQLite lokal, skrip `dev`/`build`/`test`. Tiap paket bisa build + typecheck mandiri.
2. **Infra inti**: `shared` + `db` (schema SQLite: floors, agents, issues, memories). Seed data agar bisa divalidasi segera.
3. **Gateway + AI**: `packages/gateway` + `/v1`, load balancer, token cap, kunci. Pakai `apps/server` sebagai host HTTP.
4. **GitHub + event bus**: `packages/github`, `packages/events`, intake isu → floor, webhook verifikasi.
5. **Orchestrator**: manager, agen per role/stage, pipeline status, sandbox (Sandcastle), watchdog, kickoff/wrap-up.
6. **Web app**: `/api` klien, halaman floor, live view, whiteboard, notice board, wall board.
7. **Communications**: Notice Board, integrasi pihak ketiga, laporan wrap-up.
8. **Uji**: unit per paket, integrasi gateway/database, e2e alur isu, screenshot.
9. **Site + rilis**: site dokumentasi, workflow CI, semantic-release.

## Status saat ini (selesai)
- Workspace pnpm nyala (Node 24 / pnpm 10), tsconfig, ESLint/Prettier siap.
- `packages/shared`: tipe (Floor, Agent, Issue, Memory, AIAccount), skema zod, util (nowIso, makeId, nextStage). Build OK.
- `packages/db`: SQLite lokal via `sql.js` (tanpa kompilasi native, tanpa Docker), file `.sqlite`, skema + migrasi + seed. `pnpm --filter @ai-office/db db:schema` dan `db:seed` berhasil, file `packages/db/data/office.sqlite` terbentuk. Build OK.

## 5. Target berikutnya (MVP tangkapan vertikal)
- `apps/server`: HTTP server Node bawaan (tanpa framework baru) di PORT 3045, API JSON `/api/floors`, `/api/agents`, `/api/issues`, melayani UI statis dari `apps/web/public`, backed by `@ai-office/db`.
- `apps/web`: satu halaman HTML + JS yang memanggil `/api` dan menampilkan daftar floor/issue.
- `pnpm dev` di root nyalakan server; `pnpm build` + `pnpm test` lolos.

## 6. Milestone & keluar (definisi selesai MVP)
- M1 (selesai): workspace, shared, db, SQLite lokal tanpa Docker.
- M2: `pnpm dev` nyalakan server di 3045, `GET /api/floors` mengembalikan data dari SQLite.
- M3: web UI menampilkan floor + issue dari API.
- M4: `pnpm build && pnpm test && pnpm typecheck` lolos.

## 7. Risiko (sisa)
- AI non-deterministik + sandbox agen butuh kunci AI asli & pembatasan proses; di-MVP di-mock / belum diaktifkan.
- Gateway `/v1`, GitHub App, orchestrator penuh, communications, 3D office, e2e: ditunda ke fase berikutnya (bukan bagian MVP).

Skips (YAGNI, tambah bila diminta): multi-region deploy, plugin agen pihak ketiga, mobile native, AI model fine-tuning, gateway penuh, GitHub App, orchestrator penuh, 3D office.
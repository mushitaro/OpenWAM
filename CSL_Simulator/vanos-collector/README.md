# vanos-sweep-collector

Stage-121 ライブ VANOS 掃引ログの収集器。**Tuner (`mss54hp-tuner-preview` / `RUNS_DB`) とは
完全に別のデプロイ・別の D1**（オーナー指示 2026-08-20）。Worker + D1 のみの純 API。

## デプロイ済み

**本番 URL**: `https://vanos-sweep-collector.kazuhiro-mushi.workers.dev`
D1: `vanos-sweeps` (APAC, `5ca9df07-a704-475b-98f1-fe9fadd6f056`) / トークンは `.upload-token.local`（gitignored）。
再デプロイは `npm run deploy` のみ。

<details><summary>初回セットアップ手順（実行済み・記録用）</summary>

```bash
cd CSL_Simulator/vanos-collector
npm install
npx wrangler d1 create vanos-sweeps      # 出力の database_id を wrangler.jsonc に貼る
npm run db:migrate:remote
npx wrangler secret put UPLOAD_TOKEN     # 新規トークン（Tuner のとは別物）
npm run deploy
```
</details>

## API（全経路 `Authorization: Bearer <UPLOAD_TOKEN>`、fail-closed）

| Method | Path | 内容 |
|---|---|---|
| POST | `/sweeps` | 掃引 1 本を ingest（`id` で冪等 upsert）。`samples_gz_b64` = gzip(JSON配列) の base64 |
| GET | `/sweeps?limit=N` | 一覧（新しい順） |
| GET | `/sweeps/:id` | 1 本（JSON、samples 展開込み） |
| GET | `/sweeps/:id?format=csv` | `analyze_vanos_sweep.py` が読むワイド CSV |
| DELETE | `/sweeps/:id` | 削除 |

CSV 列: `t_ms,rpm,evan1_ist,evan1_soll,avan1_ist,avan1_soll,la_f_regler1,la_f_regler2,ml,rf,psau_local,tz1..tz6,tabg,pedal,wdk1,cmd_intake,cmd_exhaust`

## ロガー側組込み（オーナー）

`client-snippet.ts` の `uploadSweep()` を掃引レコーディング終了フックに組み込む。
接続先 URL とトークンは本 Worker のもの（Tuner の sync token と共有しない）。

## 回収・分析（Claude / ローカル）

```bash
python CSL_Simulator/backend/scripts/fetch_sweep.py --list
python CSL_Simulator/backend/scripts/fetch_sweep.py <id> --analyze
```
トークンは `--token` / env `VANOS_COLLECTOR_TOKEN` / `vanos-collector/.dev.vars`。

## ローカル開発

```bash
cp .dev.vars.example .dev.vars   # UPLOAD_TOKEN を書く
npm run db:migrate:local
npm run dev                      # http://127.0.0.1:8787 (miniflare + local D1)
```

# Linux amd64 搬遷驗證清單

此為既有 CPU demo 的搬遷準備，不會自動連遠端或部署。Python 3.12 / Linux amd64；Docker 基底為官方 `python:3.12-slim-bookworm`。可重建來源為 Git commit 與隨包合法 UCI 切片，不依賴 Mac `.venv`。

## 打包與資料

`python3 scripts/package_migration.py` 產出來源 tar.gz 與 SHA256 manifest。包內僅含執行程式、精確依賴、容器設定、測試、下載/評估腳本、README 與合法 1440 筆切片。排除 Git 內部資料、秘密、虛擬環境、20 MB 原始下載快取、影片與客戶材料。Docker context 另採精確 allowlist，僅放 runtime 檔案。

無資料 volume、無資料庫、無伺服端持久 session；每次 `/api/run` 從輸入資料與控制時間軸重播。合成資料可用 seed 520 重建；UCI 切片已內附，原始快取可依來源 URL 與 SHA256 重抓。UI 自訂 CSV、未下載的匯出與尚留瀏覽器的注入/控制狀態不會持久存到伺服器，搬遷前由操作員自行匯出。

## 目標主機盤點（父端協調，未執行）

- 確認授權主機為 Linux amd64、現有 Docker / Compose、可用 2 CPU / 1 GB RAM 與磁碟。
- 確認宿主 8011 未占用、既有反向代理與存取方式；維持 loopback 綁定。不要為此自動改防火牆、IAM、SSH key 或網路。
- 先保留原部署與可回退版本，確認沒有其他 worker 同時部署。

## 目標建置與驗證（僅清單，尚未執行）

```sh
# 解包後於 signal-adaptive-monitoring 目錄；先核對 manifest 的 SHA256 / commit
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/python -m pytest -q
# 明確使用 amd64；名稱限定本 demo
# 不在尚未獲准的主機上執行以下指令
docker compose -f compose.yaml -f compose.linux-amd64.yaml config
docker compose -f compose.yaml -f compose.linux-amd64.yaml build --pull
docker compose -f compose.yaml -f compose.linux-amd64.yaml up -d
docker compose -f compose.yaml -f compose.linux-amd64.yaml ps
curl --fail http://127.0.0.1:8011/
curl --fail 'http://127.0.0.1:8011/api/data?source=uci'
```

檢查容器 health=healthy、`uname -m`=x86_64、套件版本與 UCI 切片 SHA256。用授權瀏覽器操作來源切換、核准參考建模、播放/快轉/逐筆、三種注入、凍結/回退、事件定位與匯出；確認非 TTT、未聲稱 G520 性能。記錄目標 CPU、OS、版本與 benchmark，不沿用 Mac 秒數當作 Linux 效能。

## 僅本案的預期資源名稱

Compose project=`signal-adaptive-monitoring`；service=`signal`；預期容器=`signal-adaptive-monitoring-signal-1`；本機 image=`signal-adaptive-monitoring:local`；目標 image=`signal-adaptive-monitoring:linux-amd64`；預期 network=`signal-adaptive-monitoring_default`。標籤 `ai.ogtech.demo=signal-adaptive-monitoring`。這些是本輪整理後的配置名稱，**不是聲稱已存在的 Mac 資源**。

本任務從未成功 build/run Docker；先前 socket 讀取被拒絕，此次未重試，也未盤點其他任務的 daemon。故 Mac 實際容器/映像是否存在仍需有授權者盤點；本任務沒有已知已建立 Docker 資源，也沒有宣告 volume 或不可重建的伺服端資料。

## 切換與 Mac 清理（等待父端核准，未執行）

先驗證目標健康與操作流程，再由父端確認切換；Mac 程式碼與本機交付檔保留。只處理經 labels、名稱與來源確認屬於本 demo 的容器/image/network；任何名稱不符或不能確認的資源先保留。不得全域 `docker prune`，不得刪除其他專案、Docker Desktop 全部資料或未知 volume。清理前若有瀏覽器未匯出的操作/CSV，先保存。容器配置沒有 volume，因此不需搬 volume；若盤點發現額外 volume，必須先查明來源與資料再決定。

## 驗證範圍

Mac 原生單元/API 測試與錄影已完成。29 個精確套件的 Linux amd64 wheels 已全部成功下載，檔名與 SHA256 見 linux-amd64-dependencies.json；這只證明依賴可取得，不等於已在 Linux 執行。**容器 build/run、遠端部署與切換尚未驗證，不能宣稱部署完成**。此準備不繞過既有 Docker socket 拒絕。

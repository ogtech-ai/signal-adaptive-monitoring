# Signal Adaptive Monitoring

modality=`signal` · application=`adaptive monitoring / PdM demonstration`

CPU 可跑的繁體中文時序監測實驗台。可重用於電力、製造、環控與設備監測的售前驗證；不暗示任何商業客戶關係，也不宣稱已接特定記錄器或可診斷真實故障。

## 執行

Python 3.12；建議 2 CPU / 1 GB RAM（部署建議，非硬體保證）。完整安裝約需數百 MB 磁碟，UCI 原檔另約 150 MB。無 GPU、API key 或付費服務。

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8011
```

本機開啟 http://127.0.0.1:8011 。此網址只供本機操作，不是客戶可從外網存取的網址。不要占用另一專案的 8000 埠。

```sh
# 可選：重抓官方資料並更新小切片（既有壓縮檔會快取，不反覆下載）
.venv/bin/python scripts/download_uci.py
# 測試 / 重現桌機 CPU 量測
.venv/bin/python -m pytest -q
.venv/bin/python -m scripts.benchmark
# Docker（本輪未實際 build；宿主 Docker socket 權限受限）
docker compose up --build
```

requirements.lock 為本輪 Python 環境的精確版本；Linux CI 與 Docker 尚待實跑。若尚未下載 UCI，也可完全離線使用全合成來源。建置容器需要網路安裝套件，已建好的容器執行無外部 CDN 或遠端模型相依。

## 三分鐘操作

1. 選全合成或 UCI 真實用電資料。選參考區間（預設 [0,180)）；核准展示參考工況後按「建立模型」。核准是操作員的參考選擇，不代表原資料有健康真值。
2. 按播放／暫停、10× 或 50× 快轉、逐筆，或拖曳游標。三通道切換；圖表呈現游標前最近 240 筆，評分只使用參考與當前／過去狀態。
3. 從當前游標注入尖峰、90 筆漂移或 10 筆缺值。資料圖與分數圖同步；黃區為合成修改，事件表可點選高亮定位。
4. 核准後續工況，按解除凍結，再播放。只有固定基準與校正中心偏差均 <3 MAD、且不缺值的筆次可更新。固定基準始終不變；長期 shift 保留與不可變基準的距離。
5. 凍結停止後續更新；回退撤銷最近一個中心更新並凍結。所有控制保留游標時間點，CPU 重播同一條控制時間軸。回到過去新增控制會重播實驗，這是實驗台，不是實體設備的即時控制。
6. 匯出 JSON 含資料、合成標記、控制時間軸、版本、基準參數與重建種子。清除事件會還原資料、清空模型與評分；重新建模會清空控制時間軸。

合成覆蓋率是已回放注入筆數中，任一偵測器或缺值品質警報觸發的比例。原本即會觸發警報的注入筆次也計入，因此無法歸因為注入偵測成功。它不是事件級診斷準確率；警報筆數更少也不代表改善。詳細分模型合成指標見 docs/benchmark.json。UCI 背景警報無故障真值，不能稱為真實 false positive。

## 模型與重用

- NumPy：固定 median / MAD，多通道最大標準化偏差；閾值 4。缺值填不可變參考中位數，另觸發品質警報，禁止更新，沒有未來插值。
- scikit-learn IsolationForest（BSD 3-Clause）：64 棵樹、單 CPU 執行緒、seed=520。依時間前 70% 參考資料訓練，後 30% 校準 score 的 98% 分位閾值。沒有故障標籤；不聲稱驗證集為健康資料。
- 受控基準校正：中心以 0.025 步長更新；固定 MAD、基準、ML 均不更新。明確核准 + 不可變基準門檻約束；逐筆評分先於更新。沒有自監督梯度目標，**不是 TTT，也不是 AutoML**。
- 來源每次切換會清空模型；資料與模型僅在同一設備使用。無跨設備訓練或效能宣稱。CSV 介面只接受單一設備、已按時間排序的 power_kw,voltage_v,current_a，空白為缺值，80–20000 筆；無時間欄時序由列順序決定，操作員須確認順序。
- 適配器：`app.core.validate`、`/api/data`、CSV 匯入；未來可將驗證後的單筆餵入 `Monitor.score`，本輪沒有連接 recorder 或外部串流。

## 合法資料

內附 UCI 235 前 1440 筆、一分鐘、三通道量測。作者 Georges Hebrail、Alice Berard，CC BY 4.0，來源、修改與 SHA256 見 [data/ATTRIBUTION.md](data/ATTRIBUTION.md)。合成來源固定種子；原始資料無故障真值。不再散布限制商業使用或授權不明的資料。

## 驗證與部署限制

`tests/` 覆蓋凍結、回退、先評分後更新、無標籤介面、不核准不更新、異常／缺值不更新、未來資料不影響過去、不可變基準、資料驗證與 API 重現。`scripts/ui-test.cjs` 使用 Playwright（需另安裝）與 Chrome 驗證 1440px / 390px，截圖見 docs/ui-*.png。執行例：`PLAYWRIGHT_MODULE=/tmp/signal-ui/node_modules/playwright node scripts/ui-test.cjs`。瀏覽器測試需要先啟動 API。

本輪測量 CPU/OS/套件、資料範圍與秒數見 [docs/benchmark.json](docs/benchmark.json)。未在 Genio 520 執行；不將桌機結果標為 G520 效能。Genio 520 的 NPU 推論能力不保證訓練可用。新機原始 V/I、取樣率、頻寬、通道與 SDK 待確認；100ms/點記錄與 RS485 EMS 不構成高速原始電流。

未來目標是 **GCP CPU-only Demo VM**，不是 Cloud Run。現階段只有手動 `workflow_dispatch` preflight，驗證識別字後結束；不登入 GCP、不部署、不建資源、不改 IAM／防火牆、不建長期金鑰。需先取得 project、VM、zone、規格、網路與部署授權；再由既有核准身分部署至指定 VM。Compose 只綁本機，對外展示應由核准的反向代理／TLS／存取控制提供網址。

TypeSafe（Jev）僅列未來外部文字／結構化決策候選；未呼叫服務，也沒有可下載權重或 G520 離線部署證據。

開源套件官方來源：[scikit-learn](https://github.com/scikit-learn/scikit-learn)（BSD 3-Clause）、[NumPy](https://github.com/numpy/numpy)（BSD 3-Clause）、[FastAPI](https://github.com/fastapi/fastapi)（MIT）、[Uvicorn](https://github.com/encode/uvicorn)（BSD 3-Clause）。上游套件授權隨安裝套件保留，本 repo MIT 不取代資料與上游授權。

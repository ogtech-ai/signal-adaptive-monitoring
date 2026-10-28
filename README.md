# Signal · Continuous monitoring & model lifecycle

modality=`signal` · application=`adaptive monitoring / PdM demonstration`

精緻單頁 CPU 模擬工作區：**持續訊號 → 分布漂移 → 條件觸發候選 fit → 時間切分驗收 → promotion／rollback**。手動注入為次要測試，主要情境會自動發生。不需登入、付費 API 或大型 MLOps 平台。

這是完全合成的 20Hz、seed 520 三通道訊號，不是記錄器連線、不是 G520 性能實測，也不是故障診斷。收集與漂移觸發重新 fit **不是 TTT，亦不是從舊權重 transfer learning**。

## 執行

Python 3.12，CPU-only。建議起點 2 CPU / 1 GB RAM，非目標硬體保證。

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.lock
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8011
```

開啟 http://127.0.0.1:8011 。這是本機網址，不是對外體驗網址。介面不依賴外部字型、CDN 或遠端模型。程式與公開樣本可包成容器；未在此輪執行 Docker 或遠端部署。

## 三分鐘體驗

1. 開啟後自動建立初始參考 v1，並逐窗收集。每窗 128 筆，代表 6.4 秒模擬訊號；每秒送 1 或 4 窗是加速播放，不是宣稱牆鐘即時取樣。可暫停、逐窗、切換 kW／V／A。
2. 選 4 窗／秒，觀察自動尖峰、缺值、工況漂移。右側展示合格樣本、持續漂移、冷卻時間及阻擋理由；不滿足條件不訓練。
3. 候選表呈現實際 fit 耗時與選模指標。第一次過渡中的候選可能被拒絕，分布穩定後才可能啟用 v2；結果由真實計算決定，不以動畫假裝訓練。
4. 看直方圖及漂移曲線：cobalt 為相對 active 參考的位移，灰線為相對不可變初始參考，虛線為觸發門檻。初始基準警示獨立保留，避免新模型警報減少就隱藏偏移。
5. 查看版本日期／資料窗／方法／指標。一鍵回退上一個保存模型會凍結自動訓練；串流與固定安全邊界繼續。也可手動凍結再訓練、匯出有界資料與 metadata，或重設實驗。

## 真實方法與驗收

- 訊號為固定週期＋index-seeded random noise，分批大小不改變樣本。每 2,048 筆切換一個模擬工況，前 384 筆漸變；另有稀疏尖峰與缺值。顯示標記與偵測結果分開，標記不進 fit 或資格門檻。
- 初始 512 筆：前 256 筆估計固定 64 點週期模板、MAD 尺度並 fit IF64；256–383 校準；384–447 保留選模錨點；448–511 保留最終錨點。前處理不讀留出資料。
- 當窗先以當時 active 評分，再計算分布、收集合格樣本，最後才觸發 job。全窗完成後才整理供未來模型使用；不回寫歷史分數。
- 漂移指標為三通道最大 `|目前中位數 - active 參考中位數| / 初始 MAD 穩健尺度`，門檻 1.5，需連續 3 窗；至少 768 個近期合格樣本、8 窗 cooldown，且當窗合格率至少 60%。未變分布的拒絕結果會抑制立即重試。
- 核准模擬邊界是去週期殘差功率 ±0.28 kW、電流 ±1.4 A、電壓 ±4 V；缺值、超界與窗口離群不納入訓練。這是示範策略，不能保證真實未知異常全被排除，不是通用設備安全規格。
- 三個有限候選：IsolationForest 48/96 棵、ShrunkCovariance。皆重新 fit；近期合格資料按時間 50% fit／20% 校準／15% 選模／15% 最終測試，另混入固定早期參考 256 筆 rehearsal，保留舊參考測試以免遺忘。
- 選模目標使用工況警報率、舊參考警報率與合成挑戰漏報；選出一個後才使用最終測試驗收。要求工況／錨點警報各 ≤12%、合成挑戰覆蓋 ≥92%、大偏移保留 ≥90%，且相對 active 工況警報改善 ≥5 個百分點。未過就保留 active。**改善不是只看警報減少。**
- 異常驗收為明確合成的正負尖峰、偏移與電流不一致 probes，缺值另外做品質警報。這些覆蓋率不是設備診斷準確率。合成驗收資料不進 fit 或 calibration。
- 訓練在有界 CPU worker 真正執行，顯示 queued／training／完成／拒絕及實際 UTC 時間與毫秒，不加假的延遲或進度。

## 最小 MLOps 邊界

模型、資料窗與 SHA、方法、驗收、啟用位置及回退歷程保存在工作階段記憶體。最多保存 1,536 訊號點、1,536 合格樣本、120 窗趨勢、60 警示窗、24 次歷程、6 個模型。本次資料到 100,000 筆上限前的完整窗口停止。最多 8 個工作階段，30 分鐘未取用可釋放，關頁亦會釋放。

HTTP revision 防護拒絕重複／過期動作；reset／rollback 會使舊背景工作結果失效。fit 期間凍結會阻止 promotion。輸出是 seed／策略／有界樣本／metadata，不是 pickle 或永久模型 registry；重設會清空工作階段。相同 seed 的訊號可重現；異步啟用時點另記在版本 metadata，不把 CPU 排程時間當成 deterministic。

## 測試與驗證

```sh
.venv/bin/python -m pytest -q
.venv/bin/python -m scripts.validate_lifecycle
# 另安裝 Playwright 並提供 Chrome，先啟動 API
PLAYWRIGHT_MODULE=/tmp/signal-ui/node_modules/playwright node scripts/ui-lifecycle.cjs
```

[長循環紀錄](docs/lifecycle-longrun.json) 包含 CPU/OS/版本與覆蓋範圍：Mac 原生處理 99,968 筆後停止，完成真實 promotion／rejection、回退、重複重設與容量上限檢查。tracemalloc 只代表 Python allocations，**不是總 RSS 或 G520／Linux 性能**。完整說明見 [驗證紀錄](docs/VALIDATION.md)。

## 資料與可重用適配器

本模式完全合成。原 UCI 235 CC BY 4.0 小切片、下載快取腳本、`/api/data`、原 `/api/run` median/MAD + IF 回放適配器保留供研究與後續整合，沒有把 UCI 家庭資料冒充此 20Hz 訊號或其故障真值。[UCI 作者／來源／修改／授權](data/ATTRIBUTION.md)。未連接實體記錄器；新設備取樣率、通道、頻寬、SDK 尚待提供。

程式 MIT；[scikit-learn](https://github.com/scikit-learn/scikit-learn)、[NumPy](https://github.com/numpy/numpy)、[Uvicorn](https://github.com/encode/uvicorn) 為 BSD 3-Clause，[FastAPI](https://github.com/fastapi/fastapi) 為 MIT。沒有私有客戶資料、金鑰、付費 API 或大型權重。

## 搬遷

`python3 scripts/package_migration.py` 產生不含 `.venv`、快取、秘密、影片的本機來源包。Docker context 只允許 runtime 檔案，新增 lifecycle.py 已列入。29 個既有依賴的 Linux amd64 wheels 可取得，但容器／指定主機仍由部署端獨立驗證。只使用核准主機既有 loopback 與反向代理，不自行變更路由、IAM、防火牆或 Docker 權限。

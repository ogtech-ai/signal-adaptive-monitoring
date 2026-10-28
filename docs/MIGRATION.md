# Linux amd64 來源搬遷

最新版本為 Recorder MLOps 連續模擬，請勿用舊手動注入版本的錄影或包代替。來源包白名單包含 lifecycle.py、靜態 UI、測試、鎖定依賴、公開 UCI 切片與授權；不含虛擬環境、秘密、原始下載快取、影片或私密客戶材料。Docker context 亦為精確 runtime 白名單。

## 目標驗證

部署由授權主機協調者單一操作；本任務不自行連遠端、不改路由或權限、不觸碰被拒的 Docker socket。

1. 核對來源 commit/manifest SHA256、Linux amd64、現有 Docker/Compose、loopback 8011 與反向代理。
2. 使用 **單一 Uvicorn worker**。工作階段、模型與歷史在該 process RAM；多 worker 沒有共享 registry，不能直接增加 workers。
3. 先跑 pytest，再 `docker compose -f compose.yaml -f compose.linux-amd64.yaml config`、build、up（僅授權後）。檢查 health。
4. 實際觀察自動樣本增加、分布漂移、候選重新 fit、拒絕/promotion、超界阻擋、回退/凍結與重設。不要只檢查首頁 200。
5. 於目標 CPU 重新測量，勿把 Mac 或 tracemalloc QA 數據標為目標容量/G520效能。

## 記憶體與持久資料

沒有 DB、資料 volume、金鑰或外部平台。最多 8 個 session，每個有界保存資料、6個模型與24次歷程；重設/重啟會清空。需要保留時先匯出 metadata/有界資料；這不是模型權重的永久 registry。關頁釋放，30分鐘未取用的 session 可回收。

Compose project=signal-adaptive-monitoring，service=signal；預期容器 signal-adaptive-monitoring-signal-1、image signal-adaptive-monitoring:local（目標覆寫 :linux-amd64）、network signal-adaptive-monitoring_default。這是配置名稱，不聲稱已在Mac建立資源。

本輪未建置/執行Docker，未盤點daemon；不全域prune、不刪其他專案或未知volume。只有目標完整驗證後才由父端決定切換與本案清理。保留原始程式碼與已核對的回退版本。

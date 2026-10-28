# 本輪驗證紀錄

日期：2026-10-29（工作區日期）；Python 3.12.8 / macOS 14.4 arm64 / scikit-learn 1.9.1。CPU 型號查詢受 sandbox 限制，因此只回報 arm64；非 G520。

- pytest：6 passed，2.08 秒；一個上游 Starlette / httpx 棄用警告，不影響結果。
- Chrome headless：1440×1100 與 390×844，建模、合成尖峰、逐筆、播放／暫停與重設成功；無 pageerror、無水平溢位。已檢視桌機與手機截圖。UI 測試需手動安裝 Playwright，不包含於 Python lock。
- 額外 UI：UCI source、核准、解除凍結、回退、漂移、缺值、事件定位與 JSON 匯出：PASS。
- CPU benchmark：資料與指標見 benchmark.json；原始與合成資料均 1440 筆，參考 [0,180)，後 1260 筆評分；單執行緒 IsolationForest。
- 合成資料：尖峰固定/校正覆蓋 100%、ML 0%；漂移固定約 57.8%、校正約 55.6%、ML 約 1.1%。這些結果不支持「ML 一定更好」或「校正一定改善」。缺值由品質警報抓到，不是 ML 的缺值診斷能力。
- UCI：974 筆未注入資料觸發任一警報。沒有故障真值，不能命名為 false positive；高比例顯示短參考區間跨日常負載工況的限制。注入區段 100% 覆蓋也不證明是注入造成，因未扣掉原本就會警報的筆次。
- 資料：官方 UCI 下載成功；小切片 1440 筆；archive SHA256 見 ATTRIBUTION.md。
- Docker build / Compose、Linux CI、GCP VM、實體記錄器與 G520：本輪未跑。Docker socket 存取被宿主權限阻擋；沒有使用 Docker Desktop UI。

## 發布狀態

本機獨立 Git repo 已建立。公司 GitHub 連接器以指定 link_id 查詢 ogtech-ai/signal-adaptive-monitoring 時回傳 HTTP 422（完整錯誤與實際參數見 github-search-error.json），該次搜尋未能完成查重；這不能證明組織不存在，父端已確認 installation 176246013 可見；沒有建立遠端 repo 或 push。gh 現有登入不含有效公司帳號，不使用個人 repo。需父端協調合法公司寫入通路後再發布；此為搜尋操作失敗、發布待父端協調，非已成功發布。

GCP project/VM/zone/規格與部署授權未提供。preflight workflow 只驗證字串，不碰雲端。未建立資源、IAM、金鑰或公開端點。

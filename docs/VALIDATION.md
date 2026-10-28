# 驗證紀錄

本輪為單頁 UI 改版，分析核心未變。Python 3.12.8 / macOS 14.4 arm64 / scikit-learn 1.9.1；不是 Linux 或 Genio 520 性能驗證。

## 核心與介面

- pytest：6 passed，1 個上游 Starlette/httpx 棄用警告。覆蓋先評分後更新、凍結/回退、無標籤介面、未核准/異常/缺值不更新、因果與不可變基準、資料驗證、API 重現。
- Headless Chrome 1440×1000、768×1000、390×1000：UCI 來源、參考核准、建模、播放/暫停/50×/逐筆、三種合成注入、受控校正、凍結/回退、事件聚合/篩選/鍵盤定位、切換量綱、匯出、重設、來源改變、參考改變失效處理均通過。各尺寸無 pageerror、無橫向溢位。
- 額外邊界流程：CSV 匯入、未知時間標示、參考缺值錯誤、舊模型清除、hover 數值、分析時禁用動作、來源切換取消過期請求均通過。
- 最終視覺狀態以 UCI 第 580 筆、參考 [0,180)、第 250 筆核准/解除凍結、尖峰 @400、漂移 @460–549、缺值 @550–559 呈現。三尺寸沒有外部字型/CDN/圖片請求。已人工檢視桌機與手機完整畫面。
- 新版圖表呈現固定 ±4 MAD、真實單位/時間、合成區間、連續警報區段與當前校正版本/偏移。未建模明示為預覽與空態，沒有假的分析分數。

重現腳本為 scripts/ui-test.cjs 與 scripts/ui-edgecases.cjs；完整結果見 ui-qa.json、ui-edge-qa.json、ui-visual-qa.json。Playwright 與 Chrome 為另裝測試工具，執行產品無 Node/打包步驟。

## 原始 CPU 與資料驗證範圍

CPU benchmark 保留於 benchmark.json：每來源 1440 筆、參考 [0,180)、後續 1260 筆，當時 Mac 原生分析約 2.8–2.9 秒。CPU 型號查詢受 sandbox 限制，僅回報 arm64。這輪不把既有秒數當作新硬體或 UI 效能測量。

合成訊號的尖峰固定/校正覆蓋 100%、ML 0%；漂移固定約 57.8%、校正約 55.6%、ML 約 1.1%。缺值由品質警報抓到，不是 ML 缺值診斷能力。這些結果不支持「ML 一定更好」或「校正一定改善」。

UCI 的 benchmark 中有 974 個未注入筆次觸發任一警報。原資料無故障真值，不能稱為 false positive；短參考區間跨日常負載工況有限制。注入區段高覆蓋不證明由注入造成，因未扣除原本就會警報的樣本。

官方 UCI 下載與快取切片成功；archive SHA256、作者、CC BY 4.0、修改見 data/ATTRIBUTION.md。

## 容器與發布

29 個精確鎖定依賴的 Linux amd64 wheels 已確認可下載，見 linux-amd64-dependencies.json；這不是 Linux 執行證明。Docker context 已加入新版靜態 CSS 的精確白名單。

本輪未執行 Docker build/run、遠端部署、服務/路由變更或 Mac Docker 清理；此前 socket 拒絕未重試或繞過。實體記錄器與 G520 未測。搬遷待授權者依 MIGRATION.md 在指定主機盤點與驗證。

先前已保存的無聲操作影片對應舊版介面；本輪交付新版完整截圖與操作 QA，未覆寫 Drive 影片或公開服務。

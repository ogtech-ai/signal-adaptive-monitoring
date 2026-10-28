# Recorder MLOps 驗證

目前工作流為全合成持續監測與最小模型生命週期，取代先前手動注入主導的畫面。Mac 原生 CPU、Python 3.12.8、scikit-learn 1.9.1；未在 Linux、實體記錄器或 G520 驗證。

## 核心測試

14 tests passed（1 個上游 Starlette/httpx 棄用警告）。包含原 UCI/MAD 回放相容測試，以及：

- index-seeded 訊號跨批次相同；模板/尺度/模型 fit 不使用留出資料。
- 最新資料按時間拆 fit／calibration／selection／test，索引不交疊；更改全部顯示標記不改變收集資料、候選或評分。
- 當窗先評分，promotion 只影響啟用位置之後的資料，舊分數不回寫；初始尺度與參考不可變。
- 真實候選 fit、驗收與 promotion；合成與大偏移挑戰門檻保留。
- 凍結阻止 promotion；reset／rollback 使舊背景工作失效；超過 12 窗的過期 job 不啟用。
- 重複 revision 不重複消耗資料；API 長批次被拒絕；關閉 session 可釋放且冪等；最多 8 session。
- 直方圖樣本數守恆、最小樣本門檻、cooldown、回退與初始重設。

## 長循環

見 lifecycle-longrun.json。以真實 CPU 模型跑到本次 100,000 筆上限之前的最後完整窗口 99,968 筆；檢查每批資料與模型緩衝上限、真實 promotion／rejection、回退、上限後 12 次 advance 與 12 次 reset。

訊號/合格樣本各最多 1,536、趨勢 120 窗、警示 60 窗、歷程 24 次、模型最多 6 版；此 seed 實際保存模型最多 3 版。報告內 tracemalloc 是 Python allocations 峰值，不是總 RSS，開啟 tracemalloc 與並行 UI QA 的牆鐘時間也不代表部署效能。

## 桌機與手機

Headless Chrome 1440×1000 / 390×1000 實際流程：自動流入、暫停/逐窗/加速、三候選、真實 promotion與拒絕、超界阻擋、初始位移保留、回退/凍結、鍵盤、次要手動測試、連點重設。沒有 pageerror 或整頁橫向溢位。詳見 lifecycle-ui-qa.json；小尺寸資料表使用有焦點的局部捲動，不把表格擠成無法閱讀的 tiny text。

重要狀態、圖例、門檻與表頭為 12–13px，指定文字實測對比至少 4.5:1，細節見 ui-readability-qa.json；非完整無障礙認證。

## 指標邊界與未測項

「工況警報率」不是已知真實 false positive；「合成挑戰覆蓋」不是設備診斷準確率。初始參考為程序設計的無異常週期/噪音段；大偏移與舊參考驗收亦為明確模擬。合格門檻不能保證真實未知異常全被排除，故保留初始分布、固定警示與不可變超界策略。

Docker、Linux/G520 效能、真實記錄器接入與遠端部署本輪未跑。29 個鎖定依賴 Linux amd64 wheel 可取得。未呼叫付費 API 或製造假的訓練動畫。

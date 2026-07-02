# CWA 即時氣象儀表板

即時抓取中央氣象署（CWA）開放資料，以互動地圖呈現全台測站溫度／濕度／風速／降雨量／氣壓，並提供縣市未來一週天氣預報。前端疊加 Windy 動態風場底圖。

**線上網址：** https://weather-winnieshih1107s-projects.vercel.app

---

## 功能

- **測站點位模式**：全台測站以 Leaflet.markercluster 聚合顯示，依縮放層級分級（核心測站／自動測站），點位標籤為無底色扁平數字設計
- **縣市色塊模式**（預設）：以 22 縣市邊界（GeoJSON/TopoJSON）呈現色塊圖，顏色對應該縣市內測站最高值
- **資訊類別切換**：🌡️氣溫 / 💧濕度 / 💨風速 / 🌧️降雨量 / 📊氣壓，五種指標可即時切換，套用到點位、色塊、圖例、統計面板
- **未來一週預報**：點擊任一縣市彈出 7 天預報卡（天氣圖示、高低溫、降雨機率）
- **Windy 動態底圖**：風場流線動畫，若金鑰未授權或未設定，自動 fallback 為一般 OpenStreetMap 底圖
- 資料即時抓取，無背景快取，每次請求都是最新資料

## 技術架構

| 部分 | 技術 |
| :--- | :--- |
| 後端 | Python / FastAPI（單一 `app.py`，同時作為本機開發與 Vercel serverless function 入口） |
| 前端 | 原生 HTML / CSS / JavaScript，Leaflet 1.4.x + Leaflet.markercluster + topojson-client |
| 地圖底圖 | Windy Map Forecast API（key 未授權時 fallback 為 OpenStreetMap） |
| 部署 | Vercel（GitHub 連動，push 到 main 自動重新部署） |
| 資料來源 | CWA 開放資料平台：<br>• `O-A0001-001` 自動氣象站觀測資料<br>• `F-D0047-091` 縣市未來一週天氣預報 |

### 檔案結構

```
app.py                  FastAPI 入口，/api/* 路由 + 直接掛載 frontend/ 靜態檔
fetch_weather.py        抓取/解析 CWA 測站資料；CLI 執行時另外寫出 weather.csv / weather.db
cwa_forecast.py         抓取/解析 CWA 縣市一週預報
frontend/
  index.html            主頁面
  app.js                地圖邏輯（測站聚合、色塊、指標切換、預報面板）
  style.css              樣式
  tw_counties.topo.json  縣市邊界（TopoJSON，來源：g0v/twgeojson）
design.md                最初的系統設計文件
vercel.json              Vercel function 設定（maxDuration）
requirements.txt         Python 相依套件
```

## 本機開發

```bash
pip install -r requirements.txt
```

建立 `.env`（不會被 git 追蹤）：

```
CWA_TOKEN=你的CWA開放資料授權碼
WINDY_API_KEY=你的Windy Map Forecast API key
```

啟動：

```bash
uvicorn app:app --reload --port 8000
```

> 注意：本機 `uvicorn app:app` 只會啟動 API（`/api/*`），前端頁面需另外用簡易靜態伺服器指到 `frontend/`，或直接用 `vercel dev` 讓行為與正式環境一致。

若要單獨產生 CSV／SQLite 快照（原始需求）：

```bash
python fetch_weather.py
# 產生 weather.csv 與 weather.db（兩者皆已加入 .gitignore，不會進版控）
```

## 部署（Vercel）

1. Vercel 專案 Import 這個 GitHub repo，會自動偵測 `requirements.txt` 裡的 `fastapi` 走 Python/FastAPI 框架預設
2. **Settings → Environment Variables** 設定：
   - `CWA_TOKEN`
   - `WINDY_API_KEY`
3. **Settings → Deployment Protection** 依需求決定是否關閉（關閉後任何人都可直接訪問，金鑰皆在伺服器端不會外洩）
4. 之後每次 `git push` 到 `main` 會自動觸發重新部署

---

## 建置流程紀錄

以下依時間順序整理今天的開發過程與對應的指令（prompt）。

### 1. 資料抓取與本地儲存
> 「i want to get [CWA O-A0001-001 API]，please write python and save to csv, then covert to database, called weather.db, in sqlite3 format」

- 寫出 `fetch_weather.py`：呼叫 CWA fileapi，解析 22 個欄位的測站資料，輸出 `weather.csv` 並寫入 `weather.db`（SQLite）
- 遇到 `opendata.cwa.gov.tw` 憑證鏈缺少 Subject Key Identifier、被新版 OpenSSL 拒絕的問題 → 解法：只在解析 302 轉址那一段跳過驗證，實際資料改從轉址後的 S3 網址（有效憑證）下載

### 2. Token 安全性
> 「我的TOKEN需要存到.env」
> 「py不能出現token 僅能存在.env檔」

- 導入 `python-dotenv`，token 全面改由 `.env` 讀取，程式碼中不再出現任何硬編碼金鑰

### 3. 驗證方式改為 Header
> 「modify fetch_raw.py to pass the Authorization key inside the HTTP Request Headers instead of as a query parameter in the URL」

- 除錯過程中發現：把 `Authorization` header 一併轉送給 S3 轉址目標會被誤判為 AWS 簽章格式而 400 錯誤 → 修正為只在對 CWA 主機的請求帶入該 header，S3 請求不帶

### 4. 依 design.md 建置 Web 儀表板
> 「read design.md and implement it, you can ask me question if something ambiguous」

依據設計文件實作 Windy + CWA 溫度地圖：
- Python/FastAPI 後端、in-memory 快取＋定時輪詢（後續才改為即時抓取）
- 前端：Windy 地圖初始化、Leaflet 疊圖、測站點位標籤
- 因 Windy 需要用戶端金鑰、CWA token 須留在伺服器端等考量，詢問使用者確認技術選型後才動工

之後陸續提供／修正金鑰：
> 「API CWA-50016524-...」（更新 CWA token）
> 「hIMFlXpwb5dEAsOtD8nsU5GvPBAWUmUl windy api」（提供 Windy API key）

除錯重點：
- Windy SDK 要求 Leaflet **1.4.x**，載入 1.9.4 會導致 `windyInit` 從未定義
- Windy 需要 `#windy` 容器 div，且加上 8 秒逾時 fallback，避免金鑰未授權時卡住載入畫面

### 5. 地圖視覺化優化（聚合、分級、色塊、扁平標籤）
> 附上西班牙氣溫地圖為範例：「優化# 地圖視覺化優化設計方案：即時氣象資訊圖資簡化」
> 「類似這樣視覺化呈現」

- 導入 `Leaflet.markercluster`：低縮放時聚合成溫度泡泡（顯示平均溫＋測站數）
- 測站分兩級（依測站代碼是否純數字判斷核心站／自動站），依縮放層級決定顯示範圍
- 移除白底標籤框，改為純色數字＋陰影
- 新增縣市色塊（choropleth）檢視模式：抓取 `g0v/twgeojson` 縣市邊界 TopoJSON，正規化「台」/「臺」、「桃園縣」/「桃園市」等名稱差異後，依縣市內最高溫著色

### 6. 預設檢視模式
> 「網站開啟預設呈現縣市色塊」

- 開頁預設直接顯示縣市色塊，不用手動切換

### 7. 多指標切換
> 「將爬蟲到氣象相關資訊 做成可以選擇icon資訊 讓使用者點選呈現不同分業」

- 後端補齊 `windSpeed`／`precipitation`／`pressure`／`weather` 欄位
- 前端新增 🌡️/💧/💨/🌧️/📊 五顆圖示按鈕，統一驅動點位顏色、色塊著色、圖例、統計面板

### 8. 未來一週預報
> 「增加未來預測一周氣溫」

- 找到 CWA `F-D0047-091`（縣市逐 12 小時、未來一週預報）資料集，正好對應 22 縣市
- 新增 `cwa_forecast.py` 解析每日高低溫、降雨機率、天氣現象
- 點擊縣市色塊彈出 7 天預報卡

### 9. 部署到 Vercel + GitHub 同步
> 「可以佈建到vercel與github連結 不用本機端可以即時更新資料」
> 提供 GitHub repo 網址：`https://github.com/winnieshih1107/weather`

架構調整（Vercel serverless 與傳統常駐伺服器的差異）：
- 移除背景輪詢＋記憶體快取，改為**每次請求即時向 CWA 抓資料**（更符合「即時更新」的需求，也是 Vercel serverless 的正確作法）
- `fetch_weather.py` 拆出不寫檔的 `fetch_stations()`，供 API 呼叫；CLI 用的 `fetch_and_store()` 才會寫 CSV／SQLite
- git init，只將氣象專案相關檔案加入版控（排除同資料夾內其他不相關的個人筆記／工具）

### 10. 部署除錯（實際上線後的連續修正）

上線過程中依序修好以下問題（皆由實際錯誤訊息驅動，而非憑空猜測）：

1. **`FUNCTION_INVOCATION_FAILED`**：`CWA_TOKEN` 在 import 階段就讀取環境變數，一旦沒設定會讓整個 app 崩潰（連不需要 token 的 `/api/config` 都壞掉）→ 改成在真正用到時才讀取
2. **根目錄 404 `{"detail":"Not Found"}`**：Vercel 的 FastAPI 框架預設會把所有路徑都導向該 function，`vercel.json` 的 rewrite 規則沒有真的把其他路徑排除在外
3. **`public/ directory not found at /var/task/public`**：確認 Vercel 刻意不把 `public/` 打包進 function（只當作 CDN 靜態資源），function 本身讀不到那些檔案
4. **最終解法**：資料夾改名為 `frontend/`（避開 Vercel 對 `public` 的特殊排除規則），讓 `app.py` 自己用 `StaticFiles` 掛載並提供前端檔案，不再依賴平台對靜態資源與 function 的路由優先順序
5. **預報 API `504` 逾時**：CWA 的 REST 預報端點從 Vercel 網路存取較慢，`maxDuration` 從 20 秒調高到 45 秒

### 11. Windy 網域授權
> 「去 Windy 帳號把這個網域加入授權清單」
> 「done」

- 這一步需要使用者自行登入 Windy 帳號後台加入正式網域，AI 端無法代為操作帳號登入
- 授權完成後複查：Windy 動態風場底圖成功顯示，「風場流線圖」「降雨量/雷達回波」圖層切換按鈕轉為可用狀態

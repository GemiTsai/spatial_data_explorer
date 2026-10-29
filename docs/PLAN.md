# Spatial Data Explorer — MVP 規劃

更新日期：2026-10-29

## 目標

建立 Spatial Omics 互動式資料探索工具，讓使用者在瀏覽器內查看空間資料與 UMAP、圈選細胞、比較基因表達，並將分析結果連結回組織位置。

本文件為接受的 MVP 規劃。2026-10-29 已開始實作；開發決策與驗證紀錄見 `../dev_log.md`。MVP 指 minimum viable product（最小可行產品）。

## MVP 核心操作流程

載入一份資料 → 查看 Spatial 與 UMAP → 圈選並保存 A、B 群組 → 執行探索性差異基因表達分析 → 點選結果基因 → 在 Spatial 與 UMAP 查看表達位置 → 匯出結果。

## 使用與部署假設

- 以本機部署、瀏覽器操作為目標，前端採 React 與 TypeScript，符合使用者熟悉的技術。
- 支援 Xenium、MERFISH／MERSCOPE、NanoString／Bruker CosMx；使用者所稱「Nanaotream」暫依同訊息提到的 CosMx 解讀，待實際資料確認，不視為另一個已確認平台。
- 輸入為已完成 clustering 與 annotation 的資料，不負責重新分群或註釋。
- 第一份驗證資料為 Xenium；MERSCOPE 與 CosMx 測試資料由使用者後續補充，取得並通過驗證前不宣稱已驗證支援。
- 細胞數、影像規模、資料層與可用硬體待實際檔案檢查。
- MVP 先載入既有 UMAP，不包含完整上游 QC、正規化、分群與 UMAP 重算流程。

## 介面配置

| 區域 | 功能 |
| --- | --- |
| 左側控制區 | 樣本／切片、基因搜尋、cell type／cluster、顯示設定 |
| 中央 Spatial | 細胞多邊形、metadata 著色、可用的組織影像、圈選範圍、基因表達 |
| 右側 UMAP | 既有嵌入座標，與 Spatial 共用著色與選取狀態 |
| 下方分析區 | A／B 群組、DEG 表格、表達分布與匯出 |

Spatial 與 UMAP 可調整大小或單獨放大。任一視窗選取細胞，另一視窗同步標示。

## MVP 功能範圍

### 資料載入

- 讀取已 clustering／annotated 的 `.h5ad`，配合各平台細胞邊界檔案，轉成共用資料模型；先以 Xenium 驗證完整流程。
- 自動從 `.obs` 尋找類似 `cell_type`、`celltype`、`annotation`、`annotated_cell_type` 等候選欄位，不要求新增或改名為固定 cell type 欄位，也不修改來源 `.h5ad`。
- 多個候選時顯示偵測結果並允許切換；找不到時仍可用其他 metadata 探索，不自動產生生物學註釋。
- 缺值、空白與明確標記為未註釋／unknown／unassigned 的細胞以灰色顯示；不能將合法類別誤當缺值，保留原始標籤。
- 匯入時驗證 ID、矩陣形狀、座標與資料層語意，提供可理解的錯誤訊息。
- 無影像時仍可查看細胞多邊形；無 UMAP 時明確標示該視窗不可用。

### Spatial 與 UMAP

- 每個細胞使用 `cell_polygon.parquet` 或等價的細胞邊界檔案畫成多邊形，以 cell ID 與 `.h5ad` 對齊，不靠列順序。
- 核對邊界格式、座標系統、尺度與切片／FOV；不假設所有平台使用相同檔名或欄位。缺失／無效邊界需回報數量，不捏造輪廓。
- 平移、縮放，依 metadata（例如 cell type、cluster）或單一基因著色；未註釋細胞的 metadata 著色為灰色，基因模式則依實際表達值著色。
- 若提供已對位影像，可疊加並調整透明度。
- 搜尋與切換基因，保存基因清單；多基因比較採並排視圖。
- 明確區分未測量的基因、缺值與零表達。

### 細胞選取與群組

- 支援自由套索、多邊形、矩形選取，以及新增、扣除、清除。
- Spatial 顯示多邊形；圈選仍以資料提供的細胞中心是否落在選取範圍內為第一版規則，避免僅碰到邊界即選取。缺少中心時須明確記錄由輪廓推導的方式。
- Spatial 與 UMAP 透過唯一 ID 同步，不能依列順序對應。
- 將選取結果保存為命名群組，支援 A、B 比較並顯示群組數量。
- A、B 比較前檢查空群組與重疊 ID；重疊群組須先由使用者解決。
- 顯示若採抽樣或簡化，圈選與分析仍使用完整分析範圍。

### 探索性差異基因表達分析

- 支援 A 對 B，以及 A 對使用者指定的背景；明確顯示比較範圍。
- 可限制在同一樣本、切片或 cell type 內比較，避免背景混雜。
- 使用 Scanpy `scanpy.tl.rank_genes_groups`（使用者所述 `scanpy.rank_gene_test` 對應的正式 API），不採用 pseudobulk。
- 預計使用 Wilcoxon rank-sum 與 Benjamini–Hochberg 校正，實際方法及 tie correction 明確指定並記錄，不依賴版本預設。
- 該 API 預期 logarithmized expression；檢查 `.X`、`.raw` 與 `.layers` 的語意，明確指定 `use_raw`／`layer`，不可只憑名稱判定或重複 log／normalization。資料層不明或缺少適用輸入時先提示，不直接執行。
- 結果提供基因、效應大小、兩群表達／偵測比例、p 值與多重檢定校正結果；效應大小定義與方法一併記錄。
- 支援排序、篩選、CSV 匯出；點選基因可更新 Spatial、UMAP 與表達分布圖。
- 分析定位為探索性 marker 排名；單一切片的細胞不視為獨立生物複本。
- 保留統計警語於分析介面與匯出說明：「細胞並非獨立生物複本，cell-level 比較可能造成顯著性膨脹（p 值過小、假陽性增加）；多重檢定校正不能消除此問題，結果用於探索性排序，不作病人／條件層級推論。」
- 保存群組 ID、資料版本、資料層、方法、參數與分析時間，確保結果可追溯。

### 工作保存

- 保存選取 ID、ROI 幾何、群組名稱、基因清單、分析設定與結果。
- 重新開啟相同資料可恢復工作；資料版本不符時提示，避免錯套選取結果。

## 共用資料模型

| 資料 | 要求 |
| --- | --- |
| observations | 唯一 observation_id、原始 ID、sample_id、section_id；適用時保留 patient_id、FOV／AOI |
| features | 唯一 feature_id、顯示名稱、物種、模態、gene／control 等類別 |
| matrix | observations × features；明確標示 raw／normalized、單位與稀疏格式，保留原始值 |
| spatial | xy／xyz、座標單位、局部／全局框架、方向、適用切片與轉換 |
| embedding | 既有 UMAP 座標與對應 observation_id、來源資訊 |
| metadata | 保留既有 `.obs`，自動偵測 annotation 候選欄位，記錄顯示欄位與未註釋狀態，不新增強制 cell type 欄位 |
| images／geometry | 細胞多邊形及其 ID、來源、座標轉換；選配影像、像素尺度、組織 mask |
| provenance | 平台、匯出版本、前處理、輸入檔案與資料版本 |

各表以 ID 對齊。cell、spot、bin、AOI 必須保留真實觀測單位，不能一律標為細胞。RNA、蛋白與 control 分開保存；缺失模態不補零假裝觀測。

## 架構方向

- 瀏覽器介面：React＋TypeScript，負責影像、多邊形、UMAP、選取與圖表互動。
- 本機 Python 分析服務：負責 AnnData 匯入、資料驗證、Scanpy DEG 與工作保存。
- 資料層：稀疏矩陣按需讀取，影像採金字塔／切塊，避免全量傳至瀏覽器。
- 耗時分析使用背景工作，提供進度、取消與失敗訊息。
- 多邊形渲染、影像檢視與 API 框架細節待代表性資料及硬體確認後決定，不預先承諾細胞數上限。

## MVP 外的後續功能

- Visium／Visium HD、GeoMx 等其他平台另行評估；Xenium、MERSCOPE、CosMx 已納入目標支援範圍。
- 逐轉錄本顯示、進階影像通道控制；細胞多邊形已屬 MVP 必要功能。
- 最近鄰距離、ROI 邊界內外距離、組成、密度、浸潤分析與圖表連動。
- 只有校準座標才使用 µm；只有有效面積／mask 才輸出面積密度。
- 最近細胞距離與 ROI 邊界距離為不同分析；獨立切片／未拼接 FOV 不互為鄰居。
- 本專案目前不規劃 pseudobulk；DE 維持 Scanpy 的探索性 cell-level 比較。
- 上游 QC、分群與 UMAP 重算不納入 MVP。
- 蛋白質正規化方法留待後續決定；不先套用 RNA normalization 或預設蛋白轉換方式。
- 跨平台批次整合、多使用者、伺服器部署與權限管理。

跨平台讀取與跨平台整合是不同能力；不預設不同面板與模態可直接合併分析。

## 實作階段與驗收

| 階段 | 驗收條件 |
| --- | --- |
| 1. 資料與檢視 | 指定 Xenium 註釋資料載入成功；細胞多邊形、Spatial／UMAP ID、metadata 著色、灰色未註釋狀態及可用影像對位可核對 |
| 2. 互動選取 | 兩視窗同步選取；A、B 群組、ROI 與 ID 可保存並精確恢復 |
| 3. 分析閉環 | A vs B 可執行，結果與獨立參考計算在相同方法／參數下相符；基因點選連動、結果與參數可匯出 |
| 4. 使用驗證 | 在約定資料規模與硬體下測量載入、互動、圈選與 DEG 時間，據此訂定並驗證效能門檻 |

核心完成條件：使用者能從組織或 UMAP 圈出兩群細胞，取得可追溯的探索性 DEG 結果，再查看候選基因的空間分布。

## 測試資料與驗證順序

- 首份測試資料：`/Volumes/Extreme SSD/2026_生物資訊學工作坊/Xenium_V1_Human_Kidney_FFPE_Protein_updated_outs/analysis_out/xenium_rcc_annotated.h5ad`。
- 此為使用者提供的 macOS 磁碟路徑；目前工作環境為 Windows，尚未確認該檔可存取，也尚未檢查內部欄位，不標記為已驗證。
- 需配合取得對應 `cell_polygon.parquet` 或等價細胞邊界檔案，核對 ID、座標與影像轉換；邊界檔位置尚待確認，不猜測路徑。
- MERSCOPE 與 CosMx 測試資料後續補充，再分別驗證各平台 adapter、局部／全局座標、annotation 偵測及多邊形對齊。
- 真實 `.h5ad`、邊界、影像與其他大型／研究資料保留於本機，不加入公開 Git 儲存庫；repo 僅保存規劃、程式與可公開的小型測試素材。

## 實作前待確認

1. 指定 Xenium 資料在開發環境的可存取路徑，以及對應細胞邊界檔案位置；實際檢查既有 UMAP、annotation 候選欄位與表達資料層。
2. 典型／最大細胞數、基因數、影像大小、樣本數與硬體資源。
3. 以實際資料確認「Nanaotream」是否指 NanoString／Bruker CosMx；蛋白質正規化後續再定。
4. 最優先的實際 A／B 比較案例與預期輸出。

## 2026-10-29 實作進度

- 已建立 React／TypeScript 前端、FastAPI 本機服務、Canvas 細胞多邊形與連動 UMAP、metadata／基因著色、圈選與 A／B 群組。
- 已實作 Scanpy Wilcoxon DE、獨立可取消程序、結果基因連動、表達分布、CSV／JSON 匯出、工作保存與 dataset fingerprint 檢查。
- 已實作唯讀 H5AD＋平面頂點表 Parquet 匯入、欄位映射、自動尋找 annotation 候選欄位及灰色未註釋細胞。
- 已提供需使用者確認座標的軸向對齊影像概覽、透明度調整及收藏基因並排檢視。完整影像金字塔與自動 registration 未完成。
- 合成資料的核心操作流程、匯入測試與直接 Scanpy 比對已通過。這不代表指定 Xenium 或 MERSCOPE／CosMx 真實資料驗證完成。
- 目前 importer 為記憶體模式，預設拒絕超過 250,000 細胞，沒有隱藏抽樣；效能門檻尚待真實資料測量。Parquet 先支援每頂點一列，nested／WKB／多部件輪廓需後續 adapter。

## 介面參考

- 使用者提供的 BioTuring SpatialX 截圖：影像疊加、細胞／ROI 控制、距離與組成分析。
- https://bioturing.com/documentation?tab=SPATIALX&documentation=SPATIALX_GUIDELINE
- 文件頁內容為動態載入，本次未完整取得；規劃以使用者需求及提供的截圖為依據，不宣稱已核對全部產品功能。
- Scanpy DE API 與輸入／統計限制：https://scanpy.readthedocs.io/en/latest/api/generated/scanpy.tl.rank_genes_groups.html

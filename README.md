# Spatial Data Explorer

Local React + TypeScript / Python explorer for annotated spatial omics data.

## Current implementation

- Cell polygon Spatial view and linked existing UMAP; pan/zoom, lasso, polygon and rectangle selection.
- Metadata coloring, annotation-column discovery, gray unannotated cells; gene search and expression coloring.
- Explicit A/B groups; isolated, cancellable Scanpy Wilcoxon DE with tie correction and BH adjustment.
- Gene-linked results, expression histograms, CSV/JSON export and version-checked workspace restore.
- Favorite genes side by side, metadata-category selection, manually aligned local image overviews and opacity.
- Read-only annotated H5AD + flat vertex-table Parquet import, explicit ID/coordinate mapping, import diagnostics.
- Deterministic synthetic demo (900 cells / 24 genes), clearly separated from real-data validation.

Real Xenium data validation is pending access to the supplied SSD. MERSCOPE/CosMx data have not yet been provided; these platform selections use the explicit generic annotated-data contract, not validated vendor-specific adapters. No clustering, annotation, protein normalization, or pseudobulk is performed.

## Local setup

Requires Python 3.11–3.13 and Node.js 22.12+ (only needed for frontend development/build).

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
.venv/Scripts/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

macOS/Linux: use `.venv/bin/python` instead of `.venv/Scripts/python`.

Open **http://127.0.0.1:8000**. This serves the built frontend and API from one local origin. Bind to localhost; the service intentionally rejects remote hosts/origins and is not a multi-user server.

For this workspace, a verified portable Node runtime is installed in ignored `.tools/node-*-win-x64`. Add that directory to the current terminal's PATH if Node is not installed system-wide. Project runtime files and scientific data are ignored by Git.

For frontend hot reload, start the API above and run `npm run dev` in `frontend/`, then open http://127.0.0.1:5173 (Vite proxies `/api` to Python).

## Use

1. Choose **Explore synthetic demo**, or **Open dataset** and enter local H5AD and matching Parquet paths on the server computer.
2. Map polygon cell ID, vertex X/Y, optional vertex-order column. Leave H5AD obs ID blank to use `obs_names`, or choose an existing column. No new cell-type column is required.
3. Confirm matching coordinate frame, units and section/FOV. Existing centers use `obsm['spatial']` by default; change the key if needed. When all polygons are present but centers are absent, area centroids are derived and disclosed.
4. Choose metadata or a gene; use a selection tool in either Spatial or UMAP, then **Use selection** for A/B. Polygon selection finishes with Enter or a double click; Escape cancels.
5. Select an expression layer and confirm **natural-log1p RNA expression** before DE. Unknown layer semantics must be resolved from your analysis provenance; the explorer never guesses normalization from a layer name.
6. Click a DEG row to color both views. Export the result and save workspace to retain cell IDs, ROIs, genes, parameters and provenance.

### Input boundary contract

Initial importer accepts **one row per polygon vertex**: cell ID, numeric X/Y, and optional order. For example, Xenium-style `cell_id`, `vertex_x`, `vertex_y`. Without an order column, file order within each cell must already trace the boundary. This version does not interpret nested polygon arrays, WKB, holes, multipart polygons, or vendor-specific FOV stitching automatically. Convert to a verified flat vertex table first; do not combine local FOV coordinates as if they were global.

Observation and feature IDs must be unique. IDs are joined by key, not row order. Invalid/unmatched/missing polygons are reported; missing geometry is not fabricated. A cell without valid geometry can still appear in UMAP and analyses if it has a valid center.

The initial importer loads H5AD into memory, with a default 250,000-cell refusal threshold and no hidden sampling. The API supports a deliberate `max_cells` override; this is not a performance guarantee. Full-scale tiled/WebGL data delivery requires benchmarking against real datasets.

### Optional tissue image

Expand **Aligned image overview**, enter a local PNG/JPEG/TIFF path, and explicitly provide image origin X/Y and width/height in the same coordinate frame as the polygons. Confirm axis orientation before attaching. The initial implementation supports axis-aligned, first-plane overviews only, downsampled to at most 4096 pixels per axis. Images above 50 million source pixels are refused; provide a downsampled overview. Whole-slide pyramids, automatic registration, rotated transforms and multichannel selection remain pending. Workspace files reference the local cached overview; if the cache is removed, reattach the source.

### DE interpretation

`scanpy.tl.rank_genes_groups(method='wilcoxon', tie_correct=True, corr_method='benjamini-hochberg', use_raw=False)` runs on a copied subset of the explicitly chosen layer. Mixed-modality feature types, when provided, restrict analysis to recognized RNA features. No source AnnData is modified.

Cell-level observations are not independent biological replicates. Significance can be inflated (p values too small / false positives increased); BH correction does not fix this dependence. Results are exploratory marker rankings, not patient-level inference. This warning accompanies UI and exports. Mean expression columns refer to mean log1p values; Scanpy's log2 fold change is approximate.

## Validation

```powershell
.venv/Scripts/python -m pytest tests -q --basetemp=.runtime/pytest-local
cd frontend
npm test
npm run build
```

Tests exercise shuffled-ID polygon joins, coordinate/ID rejection, immutable source H5AD, no hidden sampling, raw-layer feature identity, DE guards, direct Scanpy agreement, background job/export/cancellation, local-origin protection and selection geometry.

See [docs/PLAN.md](docs/PLAN.md) for the accepted plan and [dev_log.md](dev_log.md) for timestamped decisions, verification and remaining work.

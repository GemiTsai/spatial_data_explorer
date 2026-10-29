# Development log

All timestamps use Asia/Taipei (UTC+08:00). Entries distinguish decisions, implementation, and verified results.

## 2026-10-29 10:29 +08:00 — Implementation started

- Decision: follow `docs/PLAN.md`; React + TypeScript frontend and a local Python/FastAPI service using AnnData and Scanpy. No cloud deployment or upstream clustering/annotation.
- Decision: render cell boundary polygons on Canvas with linked Spatial/UMAP selection. Rendering and selection operate on the same stable cell IDs; no hidden sampling.
- Decision: import annotated H5AD plus explicitly mapped Parquet boundary columns. Preserve source files, discover annotation candidates, and render missing/unknown annotations gray.
- Decision: DE uses `scanpy.tl.rank_genes_groups`, Wilcoxon, explicit tie correction and BH adjustment; require explicit confirmation of a logarithmized RNA layer. Never normalize protein automatically. Keep the significance-inflation warning in UI and exports.
- Environment: Windows, Python 3.13.3; Node/npm not on PATH. Set up ignored project-local tooling and Python environment rather than changing system configuration.
- Data limitation: supplied `/Volumes/Extreme SSD/.../xenium_rcc_annotated.h5ad` is a macOS path, not verified here. Asked for Windows H5AD and boundary paths. Real Xenium validation pending; MERSCOPE/CosMx fixtures pending.
- Decision: provide a clearly labeled deterministic synthetic dataset for end-to-end development; it is not evidence of vendor-data compatibility.
- Scope: implement the core explore → select → compare → gene-view → export loop first. Large-image pyramids and vendor-specific unverified formats remain separately tracked.

## 2026-10-29 10:40 +08:00 — Core implementation and first validation

- Implemented read-only annotated H5AD + flat vertex Parquet import with explicit ID/order/spatial-key mapping, coordinate confirmation, annotation candidate discovery, missing geometry diagnostics, and SHA-256-based dataset fingerprinting.
- Implemented Canvas polygon Spatial/UMAP views, pan/zoom, rectangle/lasso/polygon selection, add/subtract/replace, linked IDs, named A/B groups, complement background, and metadata category selection.
- Implemented feature search, expression layers, favorites, independent-scale side-by-side maps, group expression histograms, and metadata coloring with gray unannotated cells.
- Implemented isolated, terminable multiprocessing Scanpy jobs, explicit input guards, no pseudobulk, RNA feature-type filtering where available, JSON/CSV with warning and provenance, and workspace download/restore.
- Decision: fingerprint includes source H5AD, polygon file, and import mapping; saved groups are refused on version mismatch. Layer confirmation resets after restore.
- Dependency decision: use project-local Node 22.23.4 and a project Python venv. Upgrade Vitest to 5.0.5 after npm audit reported vulnerable transitive dependencies; updated installation reports zero vulnerabilities.
- Initial test environment issue: sandbox denied access to Windows pytest temp/cache directories. Reran with project `.runtime/pytest-run1` and appropriate execution permissions; 9 backend tests passed. This was an environment failure, not a successful initial test run.

## 2026-10-29 10:48 +08:00 — Extended validation and remaining work

- Added explicit, axis-aligned local image overview attachment (PNG/JPEG/TIFF first plane), opacity, manual origin/extent confirmation; images above 50 million pixels are refused with instructions to supply a downsampled overview. Full-slide tiled pyramids, rotation/registration and multichannel viewing remain pending.
- Verified 11 backend tests: shuffled-ID polygon joins, source immutability, coordinate/ID rejection, no hidden sampling, unknown labels, raw feature-set identity, invalid DE groups/layers, direct Scanpy agreement, local-origin protection, background export/cancellation, explicit image alignment, and RNA/protein/control feature isolation.
- Verified TypeScript production build and 3 Vitest geometry/color tests.
- Headless Chrome end-to-end passed: selected 378 of 900 synthetic cells, compared A vs complement B, obtained 24 ranked features, clicked a result gene, displayed two favorite-gene maps, downloaded/restored workspace, reset expression confirmation, and checked responsive overflow. No severe browser-console errors.
- Browser-test correction: Selenium `clear()` did not update the React-controlled search input; switched the test to Ctrl+A/Backspace and reran successfully.
- Visual QA: inspected desktop screenshot; the two linked views, metadata controls and DE panel render correctly. Local screenshots/report live under ignored `.runtime/browser/`.
- Remaining: real Xenium SSD paths/geometry mapping; MERSCOPE and CosMx data/format verification; large-data transport/render benchmarking; nested/WKB/multipart polygon adapters; large image pyramids. Protein normalization is intentionally undecided.
- Final fixes: preserve expression-layer provenance when clicking historical DE results; CSV can also be exported after workspace restore; prevent page scrolling while zooming a canvas. Final regression checks follow these changes.

## 2026-10-29 10:51 +08:00 — Final regression and handoff

- Final regression passed: 11 pytest tests, 3 Vitest tests, TypeScript + Vite production build, Python compile check, and `git diff --check`.
- Repeated headless Chrome integration on the final build: 378-cell selection, 24 DE rows, workspace restore, two parallel gene maps, zero severe console errors, and no horizontal overflow at 760 px all passed.
- Source formatted with Prettier. Frontend lockfile retained; npm installation audit reports zero vulnerabilities.
- Local environment detail: the development venv was created with `--system-site-packages` to reuse existing scientific dependencies; updated AnnData/Scanpy/Pandas and service packages were installed into the venv without changing global packages. README provides clean-venv setup instructions.
- Known non-failing environment warnings: inherited CuPy reports no CUDA path (this app uses CPU); the installed Starlette test client deprecates its httpx compatibility path. Neither prevented validation.
- Only the C: filesystem drive is available here. The macOS `/Volumes/...` test path remains unavailable; real-data validation cannot be claimed. The local app is ready for the matching H5AD and flat polygon table when supplied.

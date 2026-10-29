"""Read-only annotated data adapters. No clustering or normalization is performed."""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

import anndata as ad
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from scipy import sparse

UNKNOWN = {"", "unknown", "unassigned", "unannotated", "unclassified", "未註釋", "未注释"}


def label(value) -> str | None:
    if pd.isna(value):
        return None
    value = str(value).strip()
    return None if value.casefold() in UNKNOWN else value


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def annotations(obs: pd.DataFrame) -> list[str]:
    def score(name):
        key = str(name).lower().replace("_", "").replace(" ", "").replace("-", "")
        return (0 if "celltype" in key else 1 if "annot" in key else 2 if "cluster" in key else 3, str(name))
    # Numeric metadata remain available too; do not require a special cell_type column.
    return sorted([str(c) for c in obs.columns if not any(isinstance(v, (list, dict, np.ndarray)) for v in obs[c].head(20))], key=score)


@dataclass
class Dataset:
    adata: ad.AnnData
    version: str
    name: str
    platform: str
    spatial: np.ndarray
    polygons: dict[str, list]
    warnings: list[str] = field(default_factory=list)
    synthetic: bool = False
    source: str = ""
    coordinate_unit: str = "unspecified"

    def __post_init__(self):
        if not self.adata.obs_names.is_unique:
            raise ValueError("Observation IDs are not unique; provide stable composite IDs before import.")
        if not self.adata.var_names.is_unique:
            raise ValueError("Feature IDs are not unique; resolve feature identity before import.")
        self.ids = self.adata.obs_names.astype(str).tolist()
        self.index = {v: i for i, v in enumerate(self.ids)}
        self.metadata_fields = annotations(self.adata.obs)
        self.metadata = {k: [label(v) for v in self.adata.obs[k]] for k in self.metadata_fields}
        if self.spatial.shape != (len(self.ids), 2) or not np.isfinite(self.spatial).all():
            raise ValueError("Spatial centers must be finite N×2 coordinates.")
        self.umap = None
        if "X_umap" in self.adata.obsm:
            points = np.asarray(self.adata.obsm["X_umap"])[:, :2]
            if points.shape != (len(self.ids), 2) or not np.isfinite(points).all():
                self.warnings.append("Invalid X_umap: UMAP view disabled.")
            else:
                self.umap = points
        if self.umap is None:
            self.warnings.append("No valid existing UMAP; embedding is not recomputed.")

    def summary(self):
        layers = ["X", *[f"layer:{k}" for k in self.adata.layers]]
        if self.adata.raw is not None:
            layers.append("raw")
        return dict(version=self.version, name=self.name, platform=self.platform,
                    n_cells=len(self.ids), n_genes=self.adata.n_vars,
                    metadata_fields=self.metadata_fields, layers=layers,
                    has_umap=self.umap is not None, synthetic=self.synthetic,
                    warnings=self.warnings, coordinate_unit=self.coordinate_unit,
                    polygon_count=len(self.polygons), source=self.source)

    def cells(self, offset: int, limit: int):
        return [dict(id=cid, spatial=self.spatial[i].tolist(),
                     umap=self.umap[i].tolist() if self.umap is not None else None,
                     polygon=self.polygons.get(cid),
                     metadata={k: v[i] for k, v in self.metadata.items()})
                for i, cid in enumerate(self.ids[offset:offset + limit], offset)]

    def expression(self, feature: str, layer: str):
        matrix, var_names = self.matrix(layer)
        if feature not in var_names:
            raise ValueError("Feature was not measured in the selected expression layer (not zero expression).")
        col = matrix[:, var_names.get_loc(feature)]
        return np.asarray(col.toarray() if sparse.issparse(col) else col).ravel()

    def matrix(self, layer: str):
        if layer == "X":
            return self.adata.X, self.adata.var_names
        if layer == "raw" and self.adata.raw is not None:
            return self.adata.raw.X, self.adata.raw.var_names
        if layer.startswith("layer:") and layer[6:] in self.adata.layers:
            return self.adata.layers[layer[6:]], self.adata.var_names
        raise ValueError("Expression layer does not exist.")


def schema(path: str):
    file = Path(path).expanduser().resolve()
    if not file.is_file() or file.suffix.lower() != ".parquet":
        raise ValueError("Provide an existing local .parquet boundary file.")
    return {"columns": [dict(name=f.name, type=str(f.type)) for f in pq.read_schema(file)]}


def load_dataset(config: dict) -> Dataset:
    path = Path(config["h5ad_path"]).expanduser().resolve()
    boundary = Path(config["polygon_path"]).expanduser().resolve()
    if not path.is_file() or path.suffix.lower() != ".h5ad":
        raise ValueError("H5AD file not found. /Volumes/... is a macOS path; provide this computer's local path.")
    if not boundary.is_file() or boundary.suffix.lower() != ".parquet":
        raise ValueError("Provide a matching local polygon Parquet file.")
    # Inspect before full allocation. Refuse oversized initial imports instead of silently sampling.
    backed = ad.read_h5ad(path, backed="r")
    try:
        if backed.n_obs > config.get("max_cells", 250_000):
            raise ValueError("Dataset exceeds the configured in-memory MVP cell limit. No cells were sampled; raise max_cells deliberately or prepare an ROI dataset.")
    finally:
        backed.file.close()
    data = ad.read_h5ad(path)
    if not data.obs_names.is_unique:
        raise ValueError("Duplicate observation IDs; use stable composite IDs.")
    id_field = config.get("obs_id_column")
    if id_field:
        if id_field not in data.obs or data.obs[id_field].isna().any():
            raise ValueError("Selected observation ID column is missing or contains null values.")
        data.obs_names = data.obs[id_field].astype(str)
        if not data.obs_names.is_unique:
            raise ValueError("Selected observation IDs are not unique; use sample/FOV composite IDs.")
    id_col, x_col, y_col = config["id_column"], config["x_column"], config["y_column"]
    order = config.get("order_column")
    columns = list(dict.fromkeys([id_col, x_col, y_col, *([order] if order else [])]))
    table = pd.read_parquet(boundary, columns=columns)
    if table[id_col].isna().any():
        raise ValueError("Polygon cell IDs contain null values.")
    table[id_col] = table[id_col].astype(str)
    if order:
        table = table.sort_values([id_col, order], kind="stable")
    polygons, invalid = {}, 0
    for cid, rows in table.groupby(id_col, sort=False):
        pts = rows[[x_col, y_col]].to_numpy(dtype=float)
        if len(pts) >= 3 and np.isfinite(pts).all() and len(np.unique(pts, axis=0)) >= 3:
            area = abs(np.dot(pts[:, 0], np.roll(pts[:, 1], 1)) - np.dot(pts[:, 1], np.roll(pts[:, 0], 1))) / 2
            if area > 0:
                polygons[cid] = pts.tolist()
                continue
        invalid += 1
    known = set(data.obs_names)
    extras = len(set(polygons) - known)
    polygons = {k: v for k, v in polygons.items() if k in known}
    if not polygons:
        raise ValueError("No valid polygons matched observation IDs. Check ID mapping, sample/FOV and polygon column format.")
    warnings = [f"Boundaries: {invalid} invalid, {extras} extra IDs, {data.n_obs - len(polygons)} cells without polygons."]
    key = config.get("spatial_key", "spatial")
    if key in data.obsm:
        centers = np.asarray(data.obsm[key])[:, :2]
    else:
        if len(polygons) != data.n_obs:
            raise ValueError("Missing spatial centers and incomplete polygons; provide valid spatial coordinates for every cell.")
        # Polygon area centroid, not mean of vertices (which depends on vertex sampling).
        def centroid(vertices):
            p = np.asarray(vertices)
            q = np.roll(p, -1, axis=0)
            cross = p[:, 0] * q[:, 1] - q[:, 0] * p[:, 1]
            return ((p + q) * cross[:, None]).sum(axis=0) / (3 * cross.sum())
        centers = np.array([centroid(polygons[cid]) for cid in data.obs_names])
        warnings.append("Spatial centers derived from area centroids of supplied polygons.")
    if not config.get("coordinates_confirmed"):
        raise ValueError("Confirm that polygon and cell-center coordinates share the same frame, units, and section/FOV.")
    mapping = {k: v for k, v in config.items() if k not in {"h5ad_path", "polygon_path"}}
    version = hashlib.sha256((sha256(path) + sha256(boundary) + json.dumps(mapping, sort_keys=True)).encode()).hexdigest()
    warnings.append("This import is in-memory; vendor-specific stitching and coordinate transformations are not inferred.")
    return Dataset(data, version, path.stem, config["platform"], centers, polygons, warnings,
                   source=str(path), coordinate_unit=config.get("coordinate_unit", "unspecified"))


def demo_dataset() -> Dataset:
    rng = np.random.default_rng(42)
    n, g = 900, 24
    names = ["EPCAM", "KRT8", "KRT18", "CD3D", "CD3E", "IL7R", "LYZ", "CD68", "C1QA", "PECAM1", "VWF", "COL1A1", "DCN", "ACTA2", "MS4A1", "CD79A", "MKI67", "PTPRC", "HLA-DRA", "VEGFA", "CA9", "PAX8", "NKG7", "GNLY"]
    clusters = rng.integers(0, 5, n)
    rates = np.full((n, g), .35)
    for k in range(5):
        rates[clusters == k, k * 3:k * 3 + 3] += 5
    counts = rng.poisson(rates).astype(np.float32)
    logged = np.log1p(counts / np.maximum(counts.sum(1, keepdims=True), 1) * 10000)
    obs = pd.DataFrame({"author_annotation": pd.Categorical([None if i % 19 == 0 else ["Epithelial", "T cells", "Myeloid", "Endothelial", "Stromal"][k] for i, k in enumerate(clusters)]), "cluster": clusters.astype(str), "sample_id": "synthetic-01"}, index=[f"demo-{i:04}" for i in range(n)])
    data = ad.AnnData(sparse.csr_matrix(logged), obs=obs, var=pd.DataFrame(index=names))
    data.layers["counts"] = sparse.csr_matrix(counts)
    data.uns["log1p"] = {"base": None}
    spatial = np.column_stack([np.arange(n) % 30, np.arange(n) // 30]) * 24 + rng.normal(0, 3, (n, 2))
    data.obsm["spatial"] = spatial
    data.obsm["X_umap"] = np.column_stack([np.cos(clusters * 1.25), np.sin(clusters * 1.25)]) * 5 + rng.normal(0, .6, (n, 2))
    angles = np.linspace(0, 2 * np.pi, 9)[:-1]
    polygons = {cid: (center + np.column_stack([np.cos(angles), np.sin(angles)]) * rng.uniform(7, 10)).tolist() for cid, center in zip(data.obs_names, spatial)}
    return Dataset(data, "synthetic-v1-seed42", "Synthetic tissue · 900 cells", "demo", spatial, polygons,
                   ["Synthetic development fixture, not human tissue or vendor validation. X is library-size normalized and log1p transformed; counts is raw synthetic RNA."], True, coordinate_unit="synthetic units")

"""Explicit, isolated cell-level exploratory DE. Source AnnData is never modified."""
from __future__ import annotations

from datetime import datetime, timezone
import importlib.metadata
import json
from pathlib import Path

import anndata as ad
import numpy as np
import pandas as pd
from scipy import sparse

WARNING = "細胞並非獨立生物複本，cell-level 比較可能造成顯著性膨脹（p 值過小、假陽性增加）；多重檢定校正不能消除此問題，結果用於探索性排序，不作病人／條件層級推論。"


def prepare(dataset, request: dict):
    a, b = request["group_a"], request["group_b"]
    if len(a) != len(set(a)) or len(b) != len(set(b)):
        raise ValueError("Group IDs must be unique.")
    if len(a) < 2 or len(b) < 2:
        raise ValueError("Each group requires at least two cells.")
    if set(a) & set(b):
        raise ValueError("Groups overlap. Remove overlapping cells before DE.")
    if (set(a) | set(b)) - set(dataset.ids):
        raise ValueError("Unknown cell IDs; reload the matching dataset.")
    if not request.get("log_rna_confirmed"):
        raise ValueError("Confirm that the selected layer is logarithmized, nonnegative RNA expression, not counts, scaled z-scores, or protein intensity.")
    matrix, var_names = dataset.matrix(request["layer"])
    indices = [dataset.index[cid] for cid in a + b]
    selected = matrix[indices].copy()
    values = selected.data if sparse.issparse(selected) else np.asarray(selected)
    if not np.isfinite(values).all() or (values < 0).any():
        raise ValueError("DE requires finite, nonnegative logarithmized RNA values.")
    if values.size and np.allclose(values, np.round(values), rtol=0, atol=1e-6):
        raise ValueError("Selected values appear integer-valued; verify that these are logarithmized RNA rather than raw counts.")
    # Preserve raw's feature identity when raw has a different feature set.
    var = dataset.adata.raw.var if request["layer"] == "raw" else dataset.adata.var
    feature_type = next((k for k in ["feature_types", "feature_type", "modality"] if k in var), None)
    if feature_type:
        types = var[feature_type].astype(str).str.casefold()
        keep = types.isin(["gene expression", "rna", "gene"]).to_numpy()
        if not keep.any():
            raise ValueError("No explicitly identified RNA features in selected layer; protein DE/normalization is deferred.")
        selected = selected[:, keep]
        var_names = var_names[keep]
    subset = ad.AnnData(selected, obs=pd.DataFrame({"comparison": pd.Categorical(["A"] * len(a) + ["B"] * len(b))}, index=a + b), var=pd.DataFrame(index=var_names))
    if subset.n_vars == 0:
        raise ValueError("No features available for the selected expression layer.")
    # User confirms natural-log1p expression; do not inherit unrelated uns/log base.
    subset.uns["log1p"] = {"base": None}
    provenance = dict(dataset_version=dataset.version, dataset_name=dataset.name,
                      synthetic=dataset.synthetic, layer=request["layer"],
                      group_a=a, group_b=b,
                      group_a_name=request.get("group_a_name", "A"), group_b_name=request.get("group_b_name", "B"),
                      method="wilcoxon", reference="B", tie_correct=True,
                      corr_method="benjamini-hochberg", use_raw=False,
                      expression_confirmation="nonnegative RNA, natural log1p, not scaled; confirmed by user",
                      feature_type_column=feature_type, n_features=subset.n_vars,
                      timestamp=datetime.now(timezone.utc).isoformat(), warning=WARNING)
    return subset, provenance


def calculate(subset: ad.AnnData, provenance: dict):
    import scanpy as sc
    sc.tl.rank_genes_groups(subset, "comparison", groups=["A"], reference="B", method="wilcoxon",
                            corr_method="benjamini-hochberg", tie_correct=True, use_raw=False, pts=True,
                            n_genes=subset.n_vars)
    frame = sc.get.rank_genes_groups_df(subset, group="A")
    matrix = subset.X
    a = (subset.obs["comparison"] == "A").to_numpy()
    means = [np.asarray(matrix[mask].mean(axis=0)).ravel() for mask in [a, ~a]]
    fractions = [np.asarray((matrix[mask] > 0).mean(axis=0)).ravel() for mask in [a, ~a]]
    rows = []
    for record in frame.to_dict("records"):
        i = subset.var_names.get_loc(record["names"])
        row = dict(gene=str(record["names"]), score=float(record["scores"]),
                   logfoldchange=float(record["logfoldchanges"]), pvalue=float(record["pvals"]),
                   padj=float(record["pvals_adj"]), mean_a=float(means[0][i]), mean_b=float(means[1][i]),
                   fraction_a=float(fractions[0][i]), fraction_b=float(fractions[1][i]))
        rows.append({k: (v if not isinstance(v, float) or np.isfinite(v) else None) for k, v in row.items()})
    provenance = {**provenance, "scanpy_version": importlib.metadata.version("scanpy"), "anndata_version": importlib.metadata.version("anndata"),
                  "effect_definition": "Scanpy approximate log2 fold change reconstructed from mean natural-log1p expression; mean_a/b are mean log1p expression."}
    return dict(rows=rows, provenance=provenance)


def worker(subset, provenance, output):
    path = Path(output)
    try:
        result = {"status": "complete", "result": calculate(subset, provenance)}
    except Exception as exc:
        result = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temporary.replace(path)

import json
import time

import anndata as ad
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from backend.analysis import WARNING, calculate, prepare
from backend.data import demo_dataset, label, load_dataset
from backend.main import app


@pytest.fixture
def demo():
    return demo_dataset()


@pytest.fixture
def config(tmp_path, demo):
    h5ad = tmp_path / "annotated.h5ad"
    polygons = tmp_path / "boundaries.parquet"
    demo.adata.write_h5ad(h5ad)
    rows = [dict(cell_id=cid, vertex_x=x, vertex_y=y, vertex_index=i) for cid, vertices in reversed(list(demo.polygons.items())) for i, (x, y) in enumerate(vertices)]
    pd.DataFrame(rows).to_parquet(polygons)
    return dict(h5ad_path=str(h5ad), polygon_path=str(polygons), platform="xenium", id_column="cell_id", x_column="vertex_x", y_column="vertex_y", order_column="vertex_index", coordinates_confirmed=True)


def test_import_aligns_shuffled_polygon_ids_without_modifying_source(config, demo):
    before = open(config["h5ad_path"], "rb").read()
    imported = load_dataset(config)
    assert imported.ids == demo.ids
    assert imported.polygons[demo.ids[0]] == demo.polygons[demo.ids[0]]
    assert imported.metadata_fields[0] == "author_annotation"
    assert imported.metadata["author_annotation"][0] is None
    assert "cell_type" not in imported.adata.obs
    assert open(config["h5ad_path"], "rb").read() == before
    assert load_dataset(config).version == imported.version


def test_import_rejects_coordinate_and_id_mismatch(config):
    with pytest.raises(ValueError, match="Confirm"):
        load_dataset({**config, "coordinates_confirmed": False})
    table = pd.read_parquet(config["polygon_path"])
    table["cell_id"] = "not-a-cell"
    table.to_parquet(config["polygon_path"])
    with pytest.raises(ValueError, match="matched"):
        load_dataset(config)


def test_no_silent_sampling(config):
    with pytest.raises(ValueError, match="No cells were sampled"):
        load_dataset({**config, "max_cells": 10})


def test_unknown_labels_preserve_real_categories():
    assert label("Unknown") is None
    assert label(np.nan) is None
    assert label("T cells") == "T cells"
    assert label("NA") == "NA"  # Do not turn arbitrary legitimate category names into missing values.


def comparison(demo):
    return dict(group_a=demo.ids[:50], group_b=demo.ids[50:100], layer="X", log_rna_confirmed=True)


def test_de_validation_and_source_isolation(demo):
    request = comparison(demo)
    with pytest.raises(ValueError, match="overlap"):
        prepare(demo, {**request, "group_b": request["group_a"]})
    with pytest.raises(ValueError, match="Confirm"):
        prepare(demo, {**request, "log_rna_confirmed": False})
    with pytest.raises(ValueError, match="integer"):
        prepare(demo, {**request, "layer": "layer:counts"})
    original = demo.adata.X.copy()
    subset, provenance = prepare(demo, request)
    subset.X[0, 0] = 100
    assert (demo.adata.X != original).nnz == 0
    assert provenance["warning"] == WARNING


def test_raw_layer_can_have_a_different_feature_set(demo):
    raw = ad.AnnData(np.full((900, 2), .7), obs=demo.adata.obs.copy(), var=pd.DataFrame(index=["raw-a", "raw-b"]))
    demo.adata.raw = raw
    subset, _ = prepare(demo, {**comparison(demo), "layer": "raw"})
    assert subset.var_names.tolist() == ["raw-a", "raw-b"]


def test_de_matches_direct_scanpy(demo):
    import scanpy as sc
    request = comparison(demo)
    subset, provenance = prepare(demo, request)
    result = calculate(subset.copy(), provenance)
    reference = subset.copy()
    sc.tl.rank_genes_groups(reference, "comparison", groups=["A"], reference="B", method="wilcoxon", tie_correct=True, corr_method="benjamini-hochberg", use_raw=False, pts=True, n_genes=24)
    direct = sc.get.rank_genes_groups_df(reference, group="A")
    assert [r["gene"] for r in result["rows"]] == direct["names"].tolist()
    np.testing.assert_allclose([r["padj"] for r in result["rows"]], direct["pvals_adj"])
    assert "rank_genes_groups" not in demo.adata.uns


def test_api_local_boundary_and_expression(demo):
    with TestClient(app) as client:
        assert client.post("/api/demo").status_code == 403
        headers = {"X-Explorer-Client": "local-ui"}
        assert client.post("/api/demo", headers={**headers, "Origin": "https://untrusted.example"}).status_code == 403
        summary = client.post("/api/demo", headers=headers).json()
        version = summary["version"]
        page = client.get(f"/api/datasets/{version}/cells?offset=0&limit=10").json()
        assert len(page["cells"]) == 10
        assert page["cells"][0]["id"] == demo.ids[0]
        assert page["cells"][0]["polygon"] == demo.polygons[demo.ids[0]]
        assert client.get(f"/api/datasets/{version}/expression?gene=NOT_MEASURED").status_code == 400
        response = client.get(f"/api/datasets/{version}/expression?gene=EPCAM").json()
        np.testing.assert_allclose(response["values"], demo.expression("EPCAM", "X"))


def test_background_de_export_and_cancel(demo):
    headers = {"X-Explorer-Client": "local-ui"}
    with TestClient(app) as client:
        summary = client.post("/api/demo", headers=headers).json()
        request = {**comparison(demo), "dataset_version": summary["version"]}
        started = client.post("/api/de", json=request, headers=headers)
        assert started.status_code == 200, started.text
        job_id = started.json()["id"]
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            state = client.get(f"/api/jobs/{job_id}").json()
            if state["status"] != "running":
                break
            time.sleep(.3)
        assert state["status"] == "complete", state
        export = client.get(f"/api/jobs/{job_id}/export?format=csv")
        assert WARNING in export.text and "provenance=" in export.text
        exported = client.get(f"/api/jobs/{job_id}/export").json()
        assert exported["provenance"]["group_a"] == request["group_a"]
        second = client.post("/api/de", json=request, headers=headers).json()["id"]
        assert client.delete(f"/api/jobs/{second}", headers=headers).json()["status"] == "cancelled"


def test_image_overlay_requires_explicit_alignment(tmp_path):
    from PIL import Image
    image = tmp_path / "overview.png"
    Image.new("RGB", (100, 80), "pink").save(image)
    headers = {"X-Explorer-Client": "local-ui"}
    with TestClient(app) as client:
        summary = client.post("/api/demo", headers=headers).json()
        url = f"/api/datasets/{summary['version']}/image"
        payload = dict(path=str(image), x=0, y=0, width=700, height=700)
        assert client.post(url, json=payload, headers=headers).status_code == 400
        overlay = client.post(url, json={**payload, "alignment_confirmed": True}, headers=headers)
        assert overlay.status_code == 200, overlay.text
        assert client.get(overlay.json()["url"]).headers["content-type"] == "image/jpeg"


def test_de_excludes_identified_protein_and_control_features(demo):
    demo.adata.var["feature_types"] = ["Gene Expression"] * 20 + ["Protein Expression", "Negative Control", "Protein Expression", "Blank"]
    subset, provenance = prepare(demo, comparison(demo))
    assert subset.n_vars == 20
    assert provenance["feature_type_column"] == "feature_types"

from __future__ import annotations

from contextlib import asynccontextmanager
import csv
import io
import json
import multiprocessing as mp
from pathlib import Path
import threading
import uuid

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

from .analysis import WARNING, prepare, worker
from .data import demo_dataset, load_dataset, schema

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / ".runtime"
datasets = {}
jobs = {}
lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    yield
    for job in jobs.values():
        process = job.get("process")
        if process and process.is_alive():
            process.terminate()
            process.join(timeout=3)


app = FastAPI(title="Spatial Data Explorer", lifespan=lifespan)


@app.middleware("http")
async def local_only(request: Request, call_next):
    # Local file access must not be callable from an arbitrary web origin.
    host = request.headers.get("host", "").split(":")[0]
    if host not in {"127.0.0.1", "localhost", "testserver"}:
        return Response("Local access only", status_code=403)
    origin = request.headers.get("origin")
    if origin:
        from urllib.parse import urlparse
        parsed = urlparse(origin)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost"} or parsed.port not in {8000, 5173, 4173}:
            return Response("Untrusted origin", status_code=403)
    if request.method in {"POST", "DELETE", "PUT"} and request.headers.get("x-explorer-client") != "local-ui":
        return Response("Missing local client header", status_code=403)
    return await call_next(request)


@app.exception_handler(ValueError)
async def invalid_input(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=400, content={"detail": str(exc)})


def get_dataset(version):
    if version not in datasets:
        raise HTTPException(404, "Dataset not loaded in this server session.")
    return datasets[version]


def register(data):
    # Single active dataset bounds memory; prevent replacement during live DE.
    if any(job["status"] == "running" and job["process"].is_alive() for job in jobs.values()):
        raise ValueError("Wait for or cancel active DE before replacing the dataset.")
    datasets.clear()
    datasets[data.version] = data
    return data.summary()


@app.get("/api/health")
def health():
    return {"status": "ok", "mode": "local", "warning": WARNING}


@app.post("/api/demo")
def demo():
    with lock:
        return register(demo_dataset())


class SchemaRequest(BaseModel):
    path: str


@app.post("/api/polygon-schema")
def polygon_schema(request: SchemaRequest):
    try:
        return schema(request.path)
    except (OSError, TypeError) as exc:
        raise ValueError(str(exc)) from exc


class ImportRequest(BaseModel):
    h5ad_path: str
    polygon_path: str
    platform: str = Field(pattern="^(xenium|merscope|cosmx)$")
    id_column: str = "cell_id"
    x_column: str = "vertex_x"
    y_column: str = "vertex_y"
    order_column: str | None = None
    obs_id_column: str | None = None
    spatial_key: str = "spatial"
    coordinates_confirmed: bool = False
    coordinate_unit: str = "unspecified"
    max_cells: int = Field(default=250_000, ge=1, le=2_000_000)


@app.post("/api/import")
def import_dataset(request: ImportRequest):
    try:
        with lock:
            return register(load_dataset(request.model_dump()))
    except (OSError, KeyError, TypeError) as exc:
        raise ValueError(f"Import failed: {exc}") from exc


@app.get("/api/datasets/{version}/cells")
def cells(version: str, offset: int = Query(0, ge=0), limit: int = Query(5000, ge=1, le=10000)):
    data = get_dataset(version)
    return {"cells": data.cells(offset, limit), "total": len(data.ids)}


@app.get("/api/datasets/{version}/genes")
def genes(version: str, q: str = "", layer: str = "X", offset: int = Query(0, ge=0)):
    _, names = get_dataset(version).matrix(layer)
    found = [str(n) for n in names if q.casefold() in str(n).casefold()]
    return {"genes": found[offset:offset + 100], "total": len(found)}


@app.get("/api/datasets/{version}/expression")
def expression(version: str, gene: str, layer: str = "X"):
    import numpy as np
    values = get_dataset(version).expression(gene, layer)
    return {"gene": gene, "layer": layer, "values": [float(v) if np.isfinite(v) else None for v in values]}


class ImageRequest(BaseModel):
    path: str
    x: float
    y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    alignment_confirmed: bool = False


@app.post("/api/datasets/{version}/image")
def attach_image(version: str, request: ImageRequest):
    get_dataset(version)
    if not request.alignment_confirmed:
        raise ValueError("Confirm image origin, physical extent and axis orientation. This initial overlay supports axis-aligned images only.")
    path = Path(request.path).expanduser().resolve()
    if not path.is_file() or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
        raise ValueError("Provide a local PNG/JPEG/TIFF overview image.")
    try:
        with Image.open(path) as image:
            if image.width * image.height > 50_000_000:
                raise ValueError("Overview exceeds 50 million pixels. Supply a downsampled, aligned overview; whole-slide pyramid delivery is pending.")
            image.thumbnail((4096, 4096))
            folder = RUNTIME / "images"
            folder.mkdir(parents=True, exist_ok=True)
            image_id = uuid.uuid4().hex
            image.convert("RGB").save(folder / f"{image_id}.jpg", quality=90)
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        raise ValueError(f"Cannot read overview: {exc}") from exc
    return dict(url=f"/api/images/{image_id}", x=request.x, y=request.y, width=request.width,
                height=request.height, opacity=.6, source_name=path.name,
                note="Downsampled first image plane, axis-aligned overview only; no automatic registration.")


@app.get("/api/images/{image_id}")
def overview_image(image_id: str):
    if len(image_id) != 32 or any(c not in "0123456789abcdef" for c in image_id):
        raise HTTPException(404, "Image not found")
    file = RUNTIME / "images" / f"{image_id}.jpg"
    if not file.is_file():
        raise HTTPException(404, "Cached overview not found; reattach source image.")
    return FileResponse(file, media_type="image/jpeg")


class DERequest(BaseModel):
    dataset_version: str
    group_a: list[str]
    group_b: list[str]
    group_a_name: str = "A"
    group_b_name: str = "B"
    layer: str = "X"
    log_rna_confirmed: bool = False


@app.post("/api/de")
def start_de(request: DERequest):
    with lock:
        if any(j["status"] == "running" and j["process"].is_alive() for j in jobs.values()):
            raise ValueError("A DE job is already running. Wait or cancel it first.")
        subset, provenance = prepare(get_dataset(request.dataset_version), request.model_dump())
        job_id = uuid.uuid4().hex
        folder = RUNTIME / "jobs"
        folder.mkdir(parents=True, exist_ok=True)
        output = folder / f"{job_id}.json"
        process = mp.get_context("spawn").Process(target=worker, args=(subset, provenance, str(output)), daemon=True)
        process.start()
        jobs[job_id] = dict(status="running", process=process, output=output,
                            dataset_version=request.dataset_version)
        return {"id": job_id, "status": "running", "progress": "Starting Scanpy worker"}


def job_state(job_id):
    if job_id not in jobs:
        raise HTTPException(404, "Job not found in this session.")
    job = jobs[job_id]
    if job["status"] == "running":
        if job["output"].exists():
            job.update(json.loads(job["output"].read_text(encoding="utf-8")))
            job["process"].join(timeout=.1)
        elif not job["process"].is_alive():
            job.update(status="failed", error="Worker exited before producing a result.")
    return {k: v for k, v in job.items() if k not in {"process", "output"}}


@app.get("/api/jobs/{job_id}")
def status(job_id: str):
    with lock:
        return job_state(job_id)


@app.delete("/api/jobs/{job_id}")
def cancel(job_id: str):
    with lock:
        state = job_state(job_id)
        if state["status"] == "running":
            jobs[job_id]["process"].terminate()
            jobs[job_id]["process"].join(timeout=3)
            jobs[job_id]["status"] = "cancelled"
        return job_state(job_id)


@app.get("/api/jobs/{job_id}/export")
def export(job_id: str, format: str = "json"):
    state = job_state(job_id)
    if state["status"] != "complete":
        raise ValueError("Only completed jobs can be exported.")
    result = state["result"]
    if format == "csv":
        buffer = io.StringIO()
        buffer.write("# " + WARNING + "\n")
        buffer.write("# provenance=" + json.dumps(result["provenance"], ensure_ascii=False) + "\n")
        writer = csv.DictWriter(buffer, fieldnames=list(result["rows"][0]))
        writer.writeheader()
        writer.writerows(result["rows"])
        return Response("\ufeff" + buffer.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="differential-expression.csv"'})
    return Response(json.dumps(result, ensure_ascii=False, allow_nan=False), media_type="application/json",
                    headers={"Content-Disposition": 'attachment; filename="analysis-with-provenance.json"'})


# Production build uses a single localhost origin, without npm at runtime.
DIST = ROOT / "frontend" / "dist"
if DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
def home():
    if (DIST / "index.html").is_file():
        return FileResponse(DIST / "index.html")
    return Response("Frontend not built. Run npm install and npm run build in frontend/.", status_code=503)

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, download, exportCSV } from './api';
import { expressionColor, mergeSelection, metadataColor } from './geometry';
import { Viewer } from './Viewer';
import { WARNING } from './types';
import type { Cell, Group, Result, Roi, Row, Summary, Overlay } from './types';

const emptyGroup = (name: string): Group => ({ name, ids: [] });
const defaultImport = {
  h5ad_path: '',
  polygon_path: '',
  platform: 'xenium',
  id_column: 'cell_id',
  x_column: 'vertex_x',
  y_column: 'vertex_y',
  order_column: '',
  obs_id_column: '',
  spatial_key: 'spatial',
  coordinate_unit: 'unspecified',
  coordinates_confirmed: false,
};
type Job = { id?: string; status: string; error?: string; result?: Result };

export default function App() {
  const [data, setData] = useState<Summary | null>(null),
    [cells, setCells] = useState<Cell[]>([]);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [metadata, setMetadata] = useState(''),
    [layer, setLayer] = useState('X'),
    [query, setQuery] = useState(''),
    [genes, setGenes] = useState<string[]>([]);
  const [gene, setGene] = useState(''),
    [values, setValues] = useState<(number | null)[] | null>(null),
    [favorites, setFavorites] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [rois, setRois] = useState<Roi[]>([]);
  const [a, setA] = useState<Group>(emptyGroup('Region A')),
    [b, setB] = useState<Group>(emptyGroup('Region B'));
  const [tool, setTool] = useState('pan'),
    [operation, setOperation] = useState('replace'),
    [confirmed, setConfirmed] = useState(false);
  const [job, setJob] = useState<Job | null>(null),
    [result, setResult] = useState<Result | null>(null),
    [sort, setSort] = useState<keyof Row>('padj'),
    [maxPadj, setMaxPadj] = useState('1');
  const [importOpen, setImportOpen] = useState(false),
    [form, setForm] = useState(defaultImport),
    [columns, setColumns] = useState<string[]>([]);
  const [parallel, setParallel] = useState(false),
    [overlay, setOverlay] = useState<Overlay | null>(null);
  const [imageForm, setImageForm] = useState({
    path: '',
    x: 0,
    y: 0,
    width: 1000,
    height: 1000,
    alignment_confirmed: false,
  });
  const restoreRef = useRef<HTMLInputElement>(null);
  const aSet = useMemo(() => new Set(a.ids), [a]),
    bSet = useMemo(() => new Set(b.ids), [b]);
  const overlap = a.ids.filter((id) => bSet.has(id)).length;
  const selectedCells = useMemo(() => cells.filter((c) => selected.has(c.id)), [cells, selected]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    cells.forEach((c) => {
      const label = c.metadata[metadata] ?? 'Unannotated';
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [cells, metadata]);
  const colors = useMemo(() => {
    let max = 0;
    values?.forEach((v) => {
      if (v != null) max = Math.max(max, v);
    });
    return cells.map((c, i) =>
      values ? expressionColor(values[i], max) : metadataColor(c.metadata[metadata]),
    );
  }, [cells, metadata, values]);
  async function load(url: string, payload?: unknown) {
    setBusy('Loading dataset…');
    setError('');
    setNotice('');
    try {
      const summary = await api<Summary>(url, {
        method: 'POST',
        body: payload ? JSON.stringify(payload) : undefined,
      });
      const all: Cell[] = [];
      for (let offset = 0; offset < summary.n_cells; offset += 5000) {
        setBusy(`Reading cells ${offset.toLocaleString()} / ${summary.n_cells.toLocaleString()}`);
        const page = await api<{ cells: Cell[] }>(
          `/datasets/${summary.version}/cells?offset=${offset}`,
        );
        all.push(...page.cells);
      }
      setData(summary);
      setCells(all);
      setMetadata(summary.metadata_fields[0] ?? '');
      setLayer('X');
      setGene('');
      setValues(null);
      setSelected(new Set());
      setRois([]);
      setA(emptyGroup('Region A'));
      setB(emptyGroup('Region B'));
      setResult(null);
      setJob(null);
      setConfirmed(false);
      setImportOpen(false);
      setFavorites([]);
      setOverlay(null);
      setParallel(false);
    } catch (e) {
      setData(null);
      setCells([]);
      setError(String(e));
    } finally {
      setBusy('');
    }
  }
  useEffect(() => {
    if (!data) return;
    let active = true;
    const timer = setTimeout(() => {
      api<{ genes: string[] }>(
        `/datasets/${data.version}/genes?q=${encodeURIComponent(query)}&layer=${encodeURIComponent(layer)}`,
      )
        .then((v) => {
          if (active) setGenes(v.genes);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [data, query, layer]);
  useEffect(() => {
    if (!data || !gene) {
      setValues(null);
      return;
    }
    let active = true;
    setValues(null);
    api<{ values: (number | null)[] }>(
      `/datasets/${data.version}/expression?gene=${encodeURIComponent(gene)}&layer=${encodeURIComponent(layer)}`,
    )
      .then((r) => {
        if (active) setValues(r.values);
      })
      .catch((e) => {
        if (active) {
          setError(String(e));
          setGene('');
        }
      });
    return () => {
      active = false;
    };
  }, [data, gene, layer]);
  useEffect(() => {
    if (!job?.id || job.status !== 'running') return;
    let active = true;
    const id = job.id;
    const timer = setInterval(() => {
      api<Job>(`/jobs/${id}`)
        .then((next) => {
          if (!active) return;
          setJob({ ...next, id });
          if (next.result) setResult(next.result);
          if (next.error) setError(next.error);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [job?.id, job?.status]);
  function select(ids: string[], roi: Roi) {
    setSelected((previous) => mergeSelection(previous, ids, operation));
    setRois((previous) => [...previous, roi]);
  }
  async function runDE() {
    if (!data) return;
    setError('');
    setResult(null);
    try {
      const response = await api<Job>('/de', {
        method: 'POST',
        body: JSON.stringify({
          dataset_version: data.version,
          group_a: a.ids,
          group_b: b.ids,
          group_a_name: a.name,
          group_b_name: b.name,
          layer,
          log_rna_confirmed: confirmed,
        }),
      });
      setJob(response);
    } catch (e) {
      setError(String(e));
    }
  }
  function save() {
    if (!data) return;
    download('spatial-explorer-workspace.json', {
      schema_version: 1,
      dataset_version: data.version,
      dataset_name: data.name,
      saved_at: new Date().toISOString(),
      metadata,
      layer,
      gene,
      favorites,
      selected: [...selected],
      rois,
      group_a: a,
      group_b: b,
      result,
      overlay,
      warning: WARNING,
    });
  }
  async function restore(file: File) {
    try {
      if (file.size > 50_000_000) throw new Error('Workspace exceeds 50 MB limit.');
      const workspace = JSON.parse(await file.text());
      if (workspace.schema_version !== 1 || workspace.dataset_version !== data?.version)
        throw new Error(
          'Workspace schema or dataset version differs. Load the matching source data first.',
        );
      const ids = new Set(cells.map((c) => c.id));
      for (const group of [workspace.selected, workspace.group_a?.ids, workspace.group_b?.ids])
        if (
          !Array.isArray(group) ||
          group.some((id: unknown) => typeof id !== 'string' || !ids.has(id))
        )
          throw new Error('Workspace contains invalid cell IDs.');
      if (
        !Array.isArray(workspace.rois) ||
        workspace.rois.some(
          (r: Roi) =>
            !['spatial', 'umap'].includes(r.space) ||
            !Array.isArray(r.points) ||
            r.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)),
        )
      )
        throw new Error('Invalid ROI geometry.');
      if (
        (workspace.metadata !== '' && !data?.metadata_fields.includes(workspace.metadata)) ||
        !data?.layers.includes(workspace.layer)
      )
        throw new Error('Workspace metadata or expression layer unavailable.');
      if (
        !Array.isArray(workspace.favorites) ||
        !workspace.favorites.every((v: unknown) => typeof v === 'string')
      )
        throw new Error('Invalid gene list.');
      if (
        workspace.overlay &&
        (!/^\/api\/images\/[a-f0-9]{32}$/.test(workspace.overlay.url) ||
          ![
            workspace.overlay.x,
            workspace.overlay.y,
            workspace.overlay.width,
            workspace.overlay.height,
            workspace.overlay.opacity,
          ].every(Number.isFinite))
      )
        throw new Error('Invalid image overlay.');
      setSelected(new Set(workspace.selected));
      setA(workspace.group_a);
      setB(workspace.group_b);
      setRois(workspace.rois);
      setMetadata(workspace.metadata);
      setLayer(workspace.layer);
      setGene(workspace.gene ?? '');
      setFavorites(workspace.favorites);
      setResult(workspace.result ?? null);
      setOverlay(workspace.overlay ?? null);
      setJob(null);
      setConfirmed(false);
      setNotice('Workspace restored. Confirm the RNA expression layer again before a new DE run.');
    } catch (e) {
      setError(String(e));
    }
  }
  const rows = useMemo(
    () =>
      result?.rows
        .filter((r) => r.padj !== null && r.padj <= Number(maxPadj))
        .sort((a, b) =>
          sort === 'gene'
            ? a.gene.localeCompare(b.gene)
            : sort === 'logfoldchange'
              ? (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity)
              : (a[sort] ?? Infinity) - (b[sort] ?? Infinity),
        ) ?? [],
    [result, sort, maxPadj],
  );
  const running = job?.status === 'running';
  const locked = !!busy || running;
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/">
          <span className="brand-icon">◈</span>
          <span>
            spatial<span className="brand-light"> explorer</span>
            <small>LOCAL RESEARCH WORKSPACE</small>
          </span>
        </a>
        <div className="header-right">
          <span className="local-badge">
            <i /> Local deployment
          </span>
          <button disabled={locked} onClick={() => setImportOpen(true)}>
            Open dataset
          </button>
          <button disabled={!data || locked} onClick={save}>
            Save workspace
          </button>
          <button disabled={!data || locked} onClick={() => restoreRef.current?.click()}>
            Restore
          </button>
        </div>
      </header>
      <input
        type="file"
        accept=".json"
        hidden
        ref={restoreRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void restore(file);
          e.target.value = '';
        }}
      />
      {error && (
        <div role="alert" className="alert error">
          {error}
          <button onClick={() => setError('')}>Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="alert">
          {notice}
          <button onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}
      {busy && (
        <div role="status" className="alert">
          {busy}
        </div>
      )}
      {!data ? (
        <main className="welcome">
          <span className="eyebrow">FROM TISSUE TO TRANSCRIPT</span>
          <h1>
            Explore the biology.
            <br />
            <em>Keep the spatial context.</em>
          </h1>
          <p>
            Inspect annotated cells, draw regions, and follow differential expression back to the
            tissue.
          </p>
          <div className="welcome-actions">
            <button className="primary" disabled={locked} onClick={() => setImportOpen(true)}>
              Open local data ↗
            </button>
            <button disabled={locked} onClick={() => void load('/demo')}>
              Explore synthetic demo
            </button>
          </div>
          <div className="feature-cards">
            <article>
              <b>01 · Spatial + UMAP</b>
              <p>Cell polygons and embeddings, connected by cell identity.</p>
            </article>
            <article>
              <b>02 · Select + compare</b>
              <p>Draw regions and compare explicit, non-overlapping groups.</p>
            </article>
            <article>
              <b>03 · Trace the signal</b>
              <p>Scanpy marker rankings with expression maps and provenance.</p>
            </article>
          </div>
          <small>
            No source files are uploaded to a cloud service. Synthetic demo data are not vendor
            validation.
          </small>
        </main>
      ) : (
        <>
          <div className="dataset-strip">
            <div>
              <span className="eyebrow">
                {data.synthetic ? 'SYNTHETIC DEMO · NOT REAL TISSUE' : data.platform.toUpperCase()}
              </span>
              <h1>{data.name}</h1>
            </div>
            <div className="dataset-stats">
              <span>
                <b>{data.n_cells.toLocaleString()}</b> cells
              </span>
              <span>
                <b>{data.n_genes.toLocaleString()}</b> features
              </span>
              <span>
                <b>{data.polygon_count.toLocaleString()}</b> polygons
              </span>
            </div>
          </div>
          <div className="workspace">
            <aside className="sidebar">
              <div className="section-label">DISPLAY</div>
              <label>
                Metadata
                <select
                  value={metadata}
                  onChange={(e) => {
                    setMetadata(e.target.value);
                    setGene('');
                  }}
                >
                  {data.metadata_fields.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label>
                Expression layer
                <select
                  value={layer}
                  onChange={(e) => {
                    setLayer(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  {data.layers.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <div className="section-label">GENE EXPRESSION</div>
              <input
                aria-label="Search genes"
                placeholder="Search measured feature IDs…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="gene-list">
                {genes.map((g) => (
                  <button className={gene === g ? 'active' : ''} key={g} onClick={() => setGene(g)}>
                    {g}
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        setFavorites((v) => (v.includes(g) ? v.filter((x) => x !== g) : [...v, g]));
                      }}
                    >
                      {favorites.includes(g) ? '★' : '☆'}
                    </span>
                  </button>
                ))}
              </div>
              {favorites.length > 0 && (
                <div className="favorites">
                  {favorites.map((g) => (
                    <button key={g} onClick={() => setGene(g)}>
                      ★ {g}
                    </button>
                  ))}
                </div>
              )}
              <button className="full-width" onClick={() => setGene('')}>
                Show metadata colors
              </button>
              <div className="section-label">
                {gene ? `EXPRESSION · ${gene}` : 'CELL COMPOSITION'}
              </div>
              {gene ? (
                <>
                  <div className="gradient" />
                  <small>
                    0 → maximum observed value · {layer}
                    <br />
                    Missing values: gray
                  </small>
                </>
              ) : (
                <div className="legend">
                  {categories.map(([name, count]) => (
                    <div key={name}>
                      <i
                        style={{ background: metadataColor(name === 'Unannotated' ? null : name) }}
                      />
                      <button
                        className="legend-select"
                        title="Select all cells in this category"
                        onClick={() =>
                          setSelected(
                            new Set(
                              cells
                                .filter((c) => (c.metadata[metadata] ?? 'Unannotated') === name)
                                .map((c) => c.id),
                            ),
                          )
                        }
                      >
                        {name}
                      </button>
                      <b>{count.toLocaleString()}</b>
                    </div>
                  ))}
                </div>
              )}
              <details className="data-notes">
                <summary>Aligned image overview</summary>
                <label>
                  Local PNG/JPEG/TIFF path
                  <input
                    value={imageForm.path}
                    onChange={(e) => setImageForm({ ...imageForm, path: e.target.value })}
                  />
                </label>
                <div className="mapping-grid">
                  {(['x', 'y', 'width', 'height'] as const).map((k) => (
                    <label key={k}>
                      {k}
                      <input
                        type="number"
                        value={imageForm[k]}
                        onChange={(e) =>
                          setImageForm({ ...imageForm, [k]: Number(e.target.value) })
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={imageForm.alignment_confirmed}
                    onChange={(e) =>
                      setImageForm({ ...imageForm, alignment_confirmed: e.target.checked })
                    }
                  />{' '}
                  Confirm origin, extent and axis orientation; axis-aligned overview only.
                </label>
                <button
                  disabled={!imageForm.alignment_confirmed || !imageForm.path}
                  onClick={() =>
                    void api<Overlay>(`/datasets/${data.version}/image`, {
                      method: 'POST',
                      body: JSON.stringify(imageForm),
                    })
                      .then(setOverlay)
                      .catch((e) => setError(String(e)))
                  }
                >
                  Attach overview
                </button>
                {overlay && (
                  <>
                    <label>
                      Image opacity
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step=".05"
                        value={overlay.opacity}
                        onChange={(e) =>
                          setOverlay({ ...overlay, opacity: Number(e.target.value) })
                        }
                      />
                    </label>
                    <small>
                      {overlay.source_name} ? {overlay.note}
                    </small>
                    <button onClick={() => setOverlay(null)}>Remove image</button>
                  </>
                )}
              </details>
              <details className="data-notes">
                <summary>Import notes & provenance</summary>
                {data.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
                <p>Dataset fingerprint: {data.version}</p>
              </details>
            </aside>
            <main className="main-workspace">
              <div className="toolbar">
                <div className="segmented">
                  {[
                    ['pan', '↔ Pan'],
                    ['lasso', '⌁ Lasso'],
                    ['polygon', '⬡ Polygon'],
                    ['rectangle', '▭ Rectangle'],
                  ].map(([v, label]) => (
                    <button
                      className={tool === v ? 'active' : ''}
                      key={v}
                      onClick={() => setTool(v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Selection operation"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value)}
                >
                  <option value="replace">Replace selection</option>
                  <option value="add">Add to selection</option>
                  <option value="subtract">Subtract selection</option>
                </select>
                <button
                  onClick={() => {
                    setSelected(new Set());
                    setRois([]);
                  }}
                >
                  Clear
                </button>
                <span className="selection-counter">{selected.size.toLocaleString()} selected</span>
              </div>
              <div className="view-grid">
                <Viewer
                  cells={cells}
                  space="spatial"
                  title="Spatial view"
                  colors={colors}
                  selected={selected}
                  a={aSet}
                  b={bSet}
                  tool={tool}
                  onSelect={select}
                  rois={rois}
                  operation={operation}
                  subtitle={`Polygon geometry · ${data.coordinate_unit}`}
                  overlay={overlay}
                />
                <Viewer
                  cells={cells}
                  space="umap"
                  title="UMAP"
                  colors={colors}
                  selected={selected}
                  a={aSet}
                  b={bSet}
                  tool={tool}
                  onSelect={select}
                  rois={rois}
                  operation={operation}
                  subtitle="Existing embedding · linked selection"
                />
              </div>
              <p className="interaction-hint">
                Scroll to zoom · drag to pan or select · polygon: click vertices, Enter or
                double-click to finish · Esc to cancel. Spatial selection uses cell centers.
              </p>
              {favorites.length > 0 && (
                <div className="parallel-controls">
                  <button onClick={() => setParallel((v) => !v)}>
                    {parallel ? 'Hide' : 'Show'} favorite genes side by side
                  </button>
                  <small>Up to 4 maps per page; independent expression scales</small>
                </div>
              )}
              {parallel && data && (
                <ParallelGenes
                  dataset={data}
                  cells={cells}
                  genes={favorites}
                  layer={layer}
                  selected={selected}
                  a={aSet}
                  b={bSet}
                />
              )}
              <section className="analysis-panel">
                <div className="analysis-header">
                  <div>
                    <span className="eyebrow">EXPLORE THE DIFFERENCE</span>
                    <h2>Differential expression</h2>
                  </div>
                  <span className="method-badge">Scanpy · Wilcoxon · BH</span>
                </div>
                <div className="group-grid">
                  <div className="group-card group-a">
                    <label>
                      Group A
                      <input
                        value={a.name}
                        onChange={(e) => setA({ ...a, name: e.target.value })}
                      />
                    </label>
                    <b>{a.ids.length.toLocaleString()} cells</b>
                    <div>
                      <button
                        disabled={!selected.size || locked}
                        onClick={() => setA({ ...a, ids: [...selected] })}
                      >
                        Use selection
                      </button>
                      <button disabled={!a.ids.length} onClick={() => setSelected(new Set(a.ids))}>
                        Highlight
                      </button>
                    </div>
                  </div>
                  <div className="group-card group-b">
                    <label>
                      Group B
                      <input
                        value={b.name}
                        onChange={(e) => setB({ ...b, name: e.target.value })}
                      />
                    </label>
                    <b>{b.ids.length.toLocaleString()} cells</b>
                    <div>
                      <button
                        disabled={!selected.size || locked}
                        onClick={() => setB({ ...b, ids: [...selected] })}
                      >
                        Use selection
                      </button>
                      <button
                        disabled={!a.ids.length || locked}
                        onClick={() =>
                          setB({ ...b, ids: cells.filter((c) => !aSet.has(c.id)).map((c) => c.id) })
                        }
                      >
                        All cells except A
                      </button>
                      <button disabled={!b.ids.length} onClick={() => setSelected(new Set(b.ids))}>
                        Highlight
                      </button>
                    </div>
                  </div>
                  <div className="run-card">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                      />{' '}
                      I confirm <b>{layer}</b> contains natural-log1p RNA expression, not counts,
                      scaled values, or protein.
                    </label>
                    <button
                      className="primary"
                      disabled={
                        !confirmed || a.ids.length < 2 || b.ids.length < 2 || overlap > 0 || locked
                      }
                      onClick={() => void runDE()}
                    >
                      {running ? 'Running Scanpy…' : 'Compare A → B'}
                    </button>
                    {running && (
                      <button
                        onClick={() =>
                          void api<Job>(`/jobs/${job.id}`, { method: 'DELETE' })
                            .then((r) => setJob({ ...r, id: job.id }))
                            .catch((e) => setError(String(e)))
                        }
                      >
                        Cancel analysis
                      </button>
                    )}
                    {job?.status === 'cancelled' && <small>Analysis cancelled.</small>}
                    {overlap > 0 && (
                      <small className="danger">
                        {overlap} overlapping IDs: redefine groups before analysis.
                      </small>
                    )}
                  </div>
                </div>
                <p className="stat-warning">{WARNING}</p>
                {result ? (
                  <>
                    <div className="result-toolbar">
                      <span>
                        <b>{rows.length}</b> ranked features
                      </span>
                      <label>
                        Adjusted p ≤{' '}
                        <input
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={maxPadj}
                          onChange={(e) => setMaxPadj(e.target.value)}
                        />
                      </label>
                      <button onClick={() => download('de-analysis.json', result)}>
                        Export analysis JSON
                      </button>
                      <button onClick={() => exportCSV(result)}>Export CSV</button>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            {[
                              ['gene', 'Gene'],
                              ['logfoldchange', 'log₂ FC ≈'],
                              ['padj', 'Adjusted p'],
                              ['pvalue', 'p value'],
                              ['fraction_a', 'Detected A'],
                              ['fraction_b', 'Detected B'],
                              ['mean_a', 'Mean log A'],
                              ['mean_b', 'Mean log B'],
                            ].map(([key, title]) => (
                              <th key={key}>
                                <button onClick={() => setSort(key as keyof Row)}>
                                  {title}
                                  {sort === key ? ' ↓' : ''}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row) => (
                            <tr
                              key={row.gene}
                              className={gene === row.gene ? 'selected-row' : ''}
                              onClick={() => {
                                setLayer(String(result.provenance.layer));
                                setGene(row.gene);
                                setQuery(row.gene);
                                setConfirmed(false);
                              }}
                            >
                              <td>
                                <button>{row.gene}</button>
                              </td>
                              <td>{row.logfoldchange?.toFixed(2) ?? 'NA'}</td>
                              <td>{row.padj?.toExponential(2) ?? 'NA'}</td>
                              <td>{row.pvalue?.toExponential(2) ?? 'NA'}</td>
                              <td>{(row.fraction_a * 100).toFixed(1)}%</td>
                              <td>{(row.fraction_b * 100).toFixed(1)}%</td>
                              <td>{row.mean_a.toFixed(2)}</td>
                              <td>{row.mean_b.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <small>
                      Results: {String(result.provenance.group_a_name)} vs{' '}
                      {String(result.provenance.group_b_name)} · layer{' '}
                      {String(result.provenance.layer)} · {String(result.provenance.timestamp)}.
                      Current display controls do not change saved results.
                    </small>
                  </>
                ) : (
                  <div className="results-empty">
                    Choose two groups to discover their expression differences.
                    <span>
                      {selectedCells.length
                        ? 'Save your selected cells to a comparison group.'
                        : 'Select cells in either view to get started.'}
                    </span>
                  </div>
                )}
                {values && gene && (
                  <ExpressionSummary values={values} a={aSet} b={bSet} cells={cells} gene={gene} />
                )}
              </section>
            </main>
          </div>
        </>
      )}
      {importOpen && (
        <div className="modal-backdrop">
          <section
            className="import-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Open local annotated data"
          >
            <div className="modal-title">
              <h2>Open annotated data</h2>
              <button disabled={!!busy} onClick={() => setImportOpen(false)}>
                Close
              </button>
            </div>
            <p>
              Use local paths on the computer running Python. Files are read without modifying the
              source.
            </p>
            <label>
              Platform
              <select
                value={form.platform}
                onChange={(e) => setForm({ ...form, platform: e.target.value })}
              >
                <option value="xenium">Xenium · real-data validation pending</option>
                <option value="merscope">MERSCOPE · test data pending</option>
                <option value="cosmx">CosMx · test data pending</option>
              </select>
            </label>
            <label>
              Annotated H5AD path
              <input
                placeholder="C:\data\annotated.h5ad or /Volumes/..."
                value={form.h5ad_path}
                onChange={(e) => setForm({ ...form, h5ad_path: e.target.value })}
              />
            </label>
            <label>
              Cell polygon Parquet path
              <input
                placeholder=".../cell_boundaries.parquet"
                value={form.polygon_path}
                onChange={(e) => {
                  setForm({ ...form, polygon_path: e.target.value });
                  setColumns([]);
                }}
              />
            </label>
            <button
              onClick={() =>
                void api<{ columns: { name: string }[] }>('/polygon-schema', {
                  method: 'POST',
                  body: JSON.stringify({ path: form.polygon_path }),
                })
                  .then((r) => setColumns(r.columns.map((c) => c.name)))
                  .catch((e) => setError(String(e)))
              }
            >
              Inspect Parquet columns
            </button>
            {columns.length > 0 && <p className="column-preview">{columns.join(' · ')}</p>}
            <p>
              Supported initial boundary format: one row per vertex, grouped by stable cell ID;
              vertex order must already be correct or supplied below. Nested polygon/WKB formats
              require an adapter.
            </p>
            <div className="mapping-grid">
              {(
                [
                  ['id_column', 'Polygon cell ID'],
                  ['x_column', 'Vertex X'],
                  ['y_column', 'Vertex Y'],
                  ['order_column', 'Vertex order (optional)'],
                  ['obs_id_column', 'H5AD obs ID column (blank = obs_names)'],
                  ['spatial_key', 'H5AD obsm spatial key'],
                ] as const
              ).map(([key, title]) => (
                <label key={key}>
                  {title}
                  <input
                    list={
                      key === 'obs_id_column' || key === 'spatial_key'
                        ? undefined
                        : 'parquet-columns'
                    }
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <datalist id="parquet-columns">
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </datalist>
            <label>
              Coordinate unit
              <select
                value={form.coordinate_unit}
                onChange={(e) => setForm({ ...form, coordinate_unit: e.target.value })}
              >
                <option value="unspecified">Unspecified (no physical distance claims)</option>
                <option value="µm">µm (verified)</option>
                <option value="pixels">Pixels</option>
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.coordinates_confirmed}
                onChange={(e) => setForm({ ...form, coordinates_confirmed: e.target.checked })}
              />{' '}
              Polygon vertices and cell centers share the same coordinate frame, units, and
              section/FOV. No automatic stitching or coordinate scaling.
            </label>
            <button
              className="primary"
              disabled={
                locked || !form.coordinates_confirmed || !form.h5ad_path || !form.polygon_path
              }
              onClick={() =>
                void load('/import', {
                  ...form,
                  order_column: form.order_column || null,
                  obs_id_column: form.obs_id_column || null,
                })
              }
            >
              Load local dataset
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function ExpressionSummary({
  values,
  a,
  b,
  cells,
  gene,
}: {
  values: (number | null)[];
  a: Set<string>;
  b: Set<string>;
  cells: Cell[];
  gene: string;
}) {
  const distributions = [a, b].map(
    (set) => values.filter((v, i) => set.has(cells[i].id) && v !== null) as number[],
  );
  let max = 1;
  for (const dist of distributions) for (const value of dist) max = Math.max(max, value);
  return (
    <div className="expression-summary">
      <b>{gene} · group expression distribution</b>
      <div className="histograms">
        {distributions.map((dist, i) => {
          const bins = Array(20).fill(0) as number[];
          dist.forEach((v) => bins[Math.min(19, Math.max(0, Math.floor((v / max) * 20)))]++);
          const top = Math.max(1, ...bins);
          return (
            <div key={i}>
              <span>
                Group {i ? 'B' : 'A'} · {dist.length} measured cells
              </span>
              <div className={`histogram ${i ? 'b' : 'a'}`}>
                {bins.map((v, k) => (
                  <i
                    key={k}
                    style={{ height: `${(v / top) * 100}%` }}
                    title={`${((k * max) / 20).toFixed(2)}–${(((k + 1) * max) / 20).toFixed(2)}: ${v} cells`}
                  />
                ))}
              </div>
              <small>0 → {max.toFixed(2)} · displayed layer</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ParallelGenes({
  dataset,
  cells,
  genes,
  layer,
  selected,
  a,
  b,
}: {
  dataset: Summary;
  cells: Cell[];
  genes: string[];
  layer: string;
  selected: Set<string>;
  a: Set<string>;
  b: Set<string>;
}) {
  const [page, setPage] = useState(0),
    [expressions, setExpressions] = useState<Record<string, (number | null)[]>>({}),
    [error, setError] = useState('');
  const pageCount = Math.ceil(genes.length / 4),
    index = Math.min(page, Math.max(0, pageCount - 1));
  const visible = genes.slice(index * 4, index * 4 + 4);
  useEffect(() => {
    let active = true;
    setExpressions({});
    setError('');
    Promise.all(
      visible.map(
        async (gene) =>
          [
            gene,
            (
              await api<{ values: (number | null)[] }>(
                `/datasets/${dataset.version}/expression?gene=${encodeURIComponent(gene)}&layer=${encodeURIComponent(layer)}`,
              )
            ).values,
          ] as const,
      ),
    )
      .then((entries) => {
        if (active) setExpressions(Object.fromEntries(entries));
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [dataset.version, layer, visible.join('|')]);
  return (
    <section className="parallel-panel">
      {error && <p role="alert">{error}</p>}
      <div className="parallel-controls">
        <button disabled={index === 0} onClick={() => setPage(index - 1)}>
          Previous
        </button>
        <small>
          {index + 1} / {pageCount} · {layer}
        </small>
        <button disabled={index + 1 >= pageCount} onClick={() => setPage(index + 1)}>
          Next
        </button>
      </div>
      <div className="view-grid">
        {visible.map((g) => {
          const values = expressions[g];
          let max = 0;
          values?.forEach((v) => {
            if (v !== null) max = Math.max(max, v);
          });
          return (
            <Viewer
              key={g}
              cells={cells}
              space="spatial"
              title={g}
              colors={cells.map((_, i) => expressionColor(values?.[i], max))}
              selected={selected}
              a={a}
              b={b}
              tool="pan"
              onSelect={() => {}}
              rois={[]}
              operation="replace"
              subtitle={values ? `0 → ${max.toFixed(2)} · ${layer}` : 'Loading expression…'}
            />
          );
        })}
      </div>
    </section>
  );
}

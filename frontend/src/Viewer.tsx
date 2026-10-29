import { useEffect, useRef, useState } from 'react';
import type { Cell, Point, Roi, Overlay } from './types';
import { inside } from './geometry';

type Props = {
  cells: Cell[];
  space: 'spatial' | 'umap';
  title: string;
  colors: string[];
  selected: Set<string>;
  a: Set<string>;
  b: Set<string>;
  tool: string;
  onSelect: (ids: string[], roi: Roi) => void;
  rois: Roi[];
  operation: string;
  subtitle: string;
  overlay?: Overlay | null;
};

export function Viewer(p: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Point>([500, 480]);
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 });
  const [draft, setDraft] = useState<Point[]>([]);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const stop = (event: WheelEvent) => event.preventDefault();
    canvas.addEventListener('wheel', stop, { passive: false });
    return () => canvas.removeEventListener('wheel', stop);
  }, []);
  useEffect(() => {
    setImage(null);
    setImageError(false);
    if (!p.overlay) return;
    let active = true;
    const img = new Image();
    img.onload = () => {
      if (active) setImage(img);
    };
    img.onerror = () => {
      if (active) setImageError(true);
    };
    img.src = p.overlay.url;
    return () => {
      active = false;
    };
  }, [p.overlay?.url]);
  const drag = useRef<{ start: Point; previous: Point; points: Point[] } | null>(null);
  const points = p.cells.map((c) => c[p.space]);
  // Include polygon extents; do not clip boundary cells on fit.
  const bounds = useRef<[number, number, number, number]>([0, 0, 1, 1]);
  useEffect(() => {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const c of p.cells) {
      const vertices =
        p.space === 'spatial' && c.polygon ? c.polygon : c[p.space] ? [c[p.space]!] : [];
      for (const [x, y] of vertices) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    bounds.current = Number.isFinite(minX) ? [minX, minY, maxX, maxY] : [0, 0, 1, 1];
    setCamera({ zoom: 1, x: 0, y: 0 });
    setDraft([]);
  }, [p.cells, p.space]);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize([r.width, r.height]);
    });
    if (wrapper.current) observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  const [x0, y0, x1, y1] = bounds.current;
  const base = Math.min(
    (size[0] - 50) / Math.max(x1 - x0, 1),
    (size[1] - 50) / Math.max(y1 - y0, 1),
  );
  const scale = base * camera.zoom;
  const origin: Point = [
    size[0] / 2 - ((x0 + x1) / 2) * scale + camera.x,
    size[1] / 2 - ((y0 + y1) / 2) * scale + camera.y,
  ];
  const screen = (point: Point): Point => [
    point[0] * scale + origin[0],
    point[1] * scale + origin[1],
  ];
  const world = (point: Point): Point => [
    (point[0] - origin[0]) / scale,
    (point[1] - origin[1]) / scale,
  ];
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ratio = devicePixelRatio || 1;
    canvas.width = size[0] * ratio;
    canvas.height = size[1] * ratio;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, ...size);
    if (image && p.overlay && p.space === 'spatial') {
      const start = screen([p.overlay.x, p.overlay.y]);
      ctx.globalAlpha = p.overlay.opacity;
      ctx.drawImage(image, ...start, p.overlay.width * scale, p.overlay.height * scale);
      ctx.globalAlpha = 1;
    }
    const path = (pts: Point[]) => {
      ctx.beginPath();
      pts.forEach((v, i) => {
        const s = screen(v);
        i ? ctx.lineTo(...s) : ctx.moveTo(...s);
      });
      ctx.closePath();
    };
    p.cells.forEach((cell, i) => {
      const point = cell[p.space];
      if (!point) return;
      const center = screen(point);
      ctx.globalAlpha = p.selected.size && !p.selected.has(cell.id) ? 0.35 : 0.9;
      ctx.fillStyle = p.colors[i];
      if (p.space === 'spatial') {
        if (!cell.polygon) return;
        path(cell.polygon);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(...center, Math.max(1.7, Math.min(4, camera.zoom * 2.2)), 0, Math.PI * 2);
        ctx.fill();
      }
      if (p.selected.has(cell.id) || p.a.has(cell.id) || p.b.has(cell.id)) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.selected.has(cell.id)
          ? '#ffffff'
          : p.a.has(cell.id)
            ? '#5ce4d1'
            : '#ffb56b';
        ctx.lineWidth = p.selected.has(cell.id) ? 1.5 : 1;
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
    p.rois
      .filter((r) => r.space === p.space)
      .forEach((r) => {
        path(r.points);
        ctx.strokeStyle = '#8cb9d480';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.stroke();
      });
    ctx.setLineDash([]);
    if (draft.length) {
      path(draft);
      ctx.fillStyle = '#7ce2d51a';
      ctx.fill();
      ctx.strokeStyle = '#b9fff0';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  });
  const local = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = event.currentTarget.getBoundingClientRect();
    return [event.clientX - r.left, event.clientY - r.top];
  };
  function finish(vertices: Point[]) {
    if (vertices.length < 3) {
      setDraft([]);
      return;
    }
    p.onSelect(
      p.cells.filter((c) => c[p.space] && inside(c[p.space]!, vertices)).map((c) => c.id),
      { space: p.space, points: vertices, operation: p.operation },
    );
    setDraft([]);
  }
  return (
    <section className="viewer">
      <div className="viewer-heading">
        <div>
          <span className="eyebrow">{p.space === 'spatial' ? 'TISSUE SPACE' : 'EMBEDDING'}</span>
          <h2>{p.title}</h2>
        </div>
        <button
          onClick={() => {
            setCamera({ zoom: 1, x: 0, y: 0 });
            setDraft([]);
          }}
        >
          Fit view
        </button>
      </div>
      <div className="canvas-wrapper" ref={wrapper}>
        <canvas
          ref={ref}
          aria-label={`${p.title} interactive cell view`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDraft([]);
            if (e.key === 'Enter' && p.tool === 'polygon') finish(draft);
          }}
          onWheel={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const s: Point = [e.clientX - r.left, e.clientY - r.top];
            const factor = Math.exp(-e.deltaY * 0.001);
            const zoom = Math.min(50, Math.max(0.3, camera.zoom * factor));
            const f = zoom / camera.zoom;
            setCamera({
              zoom,
              x: (camera.x - (s[0] - size[0] / 2)) * f + (s[0] - size[0] / 2),
              y: (camera.y - (s[1] - size[1] / 2)) * f + (s[1] - size[1] / 2),
            });
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const point = local(e);
            e.currentTarget.focus();
            if (p.tool === 'polygon') {
              setDraft([...draft, world(point)]);
              return;
            }
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { start: point, previous: point, points: [world(point)] };
            setDraft([]);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            const point = local(e);
            if (p.tool === 'pan') {
              setCamera((c) => ({
                ...c,
                x: c.x + point[0] - d.previous[0],
                y: c.y + point[1] - d.previous[1],
              }));
              d.previous = point;
              return;
            }
            if (p.tool === 'rectangle') {
              const a = world(d.start),
                b = world(point);
              d.points = [a, [b[0], a[1]], b, [a[0], b[1]]];
            } else d.points.push(world(point));
            setDraft([...d.points]);
          }}
          onPointerUp={() => {
            const d = drag.current;
            if (!d) return;
            drag.current = null;
            if (p.tool !== 'pan') finish(d.points);
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDraft([]);
          }}
          onDoubleClick={() => {
            if (p.tool === 'polygon') finish(draft);
          }}
        />
        {!points.some(Boolean) && <div className="empty-overlay">No existing UMAP available</div>}
        {imageError && (
          <div className="image-error">Overview cache missing; reattach the local image.</div>
        )}
        <div className="view-footer">
          <span>{p.subtitle}</span>
          <span>{camera.zoom.toFixed(1)}×</span>
        </div>
      </div>
    </section>
  );
}

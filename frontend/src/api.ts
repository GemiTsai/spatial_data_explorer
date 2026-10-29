export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Explorer-Client': 'local-ui',
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.detail === 'string'
        ? body.detail
        : JSON.stringify(body.detail ?? response.statusText),
    );
  }
  return response.json();
}

export function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCSV(result: import('./types').Result) {
  const columns = [
    'gene',
    'score',
    'logfoldchange',
    'pvalue',
    'padj',
    'mean_a',
    'mean_b',
    'fraction_a',
    'fraction_b',
  ] as const;
  const quote = (v: unknown) => '"' + String(v ?? '').replaceAll('"', '""') + '"';
  const lines = [
    '# ' + String(result.provenance.warning),
    '# provenance=' + JSON.stringify(result.provenance),
    columns.join(','),
    ...result.rows.map((row) => columns.map((k) => quote(row[k])).join(',')),
  ];
  const url = URL.createObjectURL(
    new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'differential-expression.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

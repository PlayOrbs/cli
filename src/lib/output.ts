export interface OutputOptions {
  json?: boolean;
}

export function output(data: unknown, opts: OutputOptions): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(data, replacer, 2) + '\n');
  } else if (typeof data === 'string') {
    process.stdout.write(data + '\n');
  } else {
    process.stdout.write(JSON.stringify(data, replacer, 2) + '\n');
  }
}

export function outputError(message: string, code: number, opts: OutputOptions): never {
  if (opts.json) {
    process.stderr.write(JSON.stringify({ error: message, code }, null, 2) + '\n');
  } else {
    process.stderr.write(`Error: ${message}\n`);
  }
  process.exit(code);
}

export function outputTable(
  headers: string[],
  rows: string[][],
  opts: OutputOptions,
  rawData?: unknown,
): void {
  if (opts.json) {
    process.stdout.write(JSON.stringify(rawData ?? rows, replacer, 2) + '\n');
    return;
  }

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.max(h.length, maxRow);
  });

  // Print header
  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  process.stdout.write(headerLine + '\n');
  process.stdout.write(widths.map(w => '─'.repeat(w)).join('──') + '\n');

  // Print rows
  for (const row of rows) {
    const line = row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  ');
    process.stdout.write(line + '\n');
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

export const EXIT_CODES = {
  SUCCESS: 0,
  ERROR: 1,
  ROUND_UNAVAILABLE: 2,
  INSUFFICIENT_BALANCE: 3,
  ALREADY_JOINED: 4,
} as const;

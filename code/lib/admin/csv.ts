// A CSV reader for the admin import (P7-03, ADM03). RFC 4180: quoted fields, doubled quotes, line breaks inside quotes,
// CRLF or LF or CR between rows, an optional byte-order mark. Pure and DOM-free, so it is unit-tested. It reads text
// the admin chose, in the admin's own browser, and sends nothing anywhere until the preview is confirmed.

export class CsvError extends Error {
  constructor(
    message: string,
    /** 1-based line where the problem is. */
    readonly line: number,
  ) {
    super(message);
    this.name = "CsvError";
  }
}

/** A guard against a file that is not a company list: far beyond a real one, well short of freezing a tab. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 2000;

/**
 * Parses CSV text into rows of cells. Lines with nothing on them are dropped. A quote that opens a cell starts a quoted
 * value; a quote in the middle of an unquoted cell is kept as it is. Throws CsvError for a quote that is never closed.
 */
export function parseCsv(text: string): string[][] {
  if (text.length > MAX_CSV_BYTES) throw new CsvError(`The file is larger than ${MAX_CSV_BYTES / 1024 / 1024} MB.`, 1);
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let quoteOpenedOnLine = 1;
  let line = 1;
  /** True once anything (a character, a quote, or a comma) has been read on this line. */
  let rowStarted = false;

  const endRow = () => {
    row.push(cell);
    rows.push(row);
    row = [];
    cell = "";
    rowStarted = false;
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
      quoteOpenedOnLine = line;
      rowStarted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
      rowStarted = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      if (rowStarted || cell !== "") endRow();
      line++;
    } else {
      cell += ch;
      rowStarted = true;
    }
  }
  if (inQuotes) throw new CsvError("A quoted value is never closed.", quoteOpenedOnLine);
  if (rowStarted || cell !== "") endRow();
  if (rows.length > MAX_CSV_ROWS + 1) throw new CsvError(`An import is limited to ${MAX_CSV_ROWS} rows; this file has ${rows.length - 1}.`, 1);
  return rows;
}

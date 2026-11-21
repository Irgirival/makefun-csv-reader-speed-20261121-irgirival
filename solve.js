// Fast drop-in for make.fun's csv-reader 1.0.0.
//
// Returns exactly csv-reader's answer {columns, rows, errors} for every input
// {text, header}. Written from the reference's documented behaviour (RULES.txt)
// and verified against its outputs on the practice set and on fuzzed inputs.
//
// The reference reads one character at a time; this one jumps with indexOf
// (a C++ scan) and slice (a C++ copy), so a plain field costs a few scans of
// its own span instead of a loop over every character. Records with no quote
// at all take a whole-line fast path (one slice + split). Field readers return
// the string alone and report how the field ended through `fieldEnded`, so no
// result object is allocated per field. All error records, line/row
// attribution and field padding/cutting follow the reference exactly.

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended: at a comma, at a line break, at the end.
  const COMMA = 0;
  const LB = 1;
  const END = 2;
  let fieldEnded = END;
  // Characters kept by the last unquoted read (not its initial content):
  // the quote_junk check reads it.
  let fieldAdded = 0;

  // Reads an unquoted field starting at pos, with `value` as its initial
  // content; returns the field's string and sets fieldEnded / fieldAdded. A CR
  // not followed by LF is dropped (stray_cr); a CR right before the field's
  // line break is that break's CRLF, not a stray one. Advances pos and line.
  function readUnquoted(value) {
    const p = pos;
    const comma = text.indexOf(',', p);
    const lf = text.indexOf('\n', p);
    let end;
    let kind;
    if (comma !== -1 && (lf === -1 || comma < lf)) {
      end = comma;
      kind = COMMA;
    } else if (lf !== -1) {
      end = lf;
      kind = LB;
    } else {
      end = n;
      kind = END;
    }
    const chunk = text.slice(p, end);
    if (chunk.indexOf('\r') === -1) {
      fieldAdded = chunk.length;
      const out = value === "" ? chunk : value + chunk;
      if (kind === COMMA) {
        pos = end + 1;
        fieldEnded = COMMA;
        return out;
      }
      if (kind === LB) {
        pos = end + 1;
        line += 1;
        fieldEnded = LB;
        return out;
      }
      pos = end;
      fieldEnded = END;
      return out;
    }
    // CRs present. A trailing CR before a line break is the CRLF's (no
    // error); every other CR in the span is stray (one error each).
    let body = chunk;
    if (kind === LB && chunk.charCodeAt(chunk.length - 1) === 13) body = chunk.slice(0, -1);
    let cleaned = '';
    let stray = 0;
    let from = 0;
    for (;;) {
      const c = body.indexOf('\r', from);
      if (c === -1) {
        cleaned += body.slice(from);
        break;
      }
      cleaned += body.slice(from, c);
      stray += 1;
      from = c + 1;
    }
    fieldAdded = cleaned.length;
    for (let i = 0; i < stray; i++) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
    const out = value === "" ? cleaned : value + cleaned;
    if (kind === COMMA) {
      pos = end + 1;
      fieldEnded = COMMA;
      return out;
    }
    if (kind === LB) {
      pos = end + 1;
      line += 1;
      fieldEnded = LB;
      return out;
    }
    pos = end;
    fieldEnded = END;
    return out;
  }

  // Reads a quoted field whose opening quote is at pos; returns the field's
  // string and sets fieldEnded.
  function readQuoted() {
    const open = pos;
    let value = '';
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        pos = open + 1;
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += text.slice(p, q) + '"';
        p = q + 2;
        continue;
      }
      // The closing quote is at q.
      value += text.slice(p, q);
      // Each CRLF or lone CR inside it reads as LF; count the line breaks.
      if (value.indexOf('\r') !== -1) value = value.replace(/\r\n?/g, '\n');
      let breaks = 0;
      let i = value.indexOf('\n');
      while (i !== -1) {
        breaks += 1;
        i = value.indexOf('\n', i + 1);
      }
      line += breaks;
      pos = q + 1;
      if (pos >= n) {
        fieldEnded = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos += 1;
        fieldEnded = COMMA;
        return value;
      }
      if (c === 10) {
        pos += 1;
        line += 1;
        fieldEnded = LB;
        return value;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fieldEnded = LB;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      const junk = readUnquoted(value);
      if (fieldAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      return junk;
    }
  }

  // Finishes a record's fields: sets the width, takes the header, or pads /
  // cuts the row to the width and records short_row / long_row.
  function finish(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record holds no quote before its next line break, so
    // every field is unquoted and the record ends at that break.
    const nl = text.indexOf('\n', pos);
    const recEnd = nl === -1 ? n : nl;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= recEnd) {
      const lineText = text.slice(pos, recEnd);
      const crAt = lineText.indexOf('\r');
      if (crAt === -1) {
        const fields = lineText.split(',');
        pos = nl === -1 ? n : nl + 1;
        if (nl !== -1) line += 1;
        finish(fields);
        continue;
      }
      if (nl !== -1 && crAt === lineText.length - 1) {
        // The only CR is the CRLF's, at the end of the line.
        const fields = lineText.slice(0, -1).split(',');
        pos = nl + 1;
        line += 1;
        finish(fields);
        continue;
      }
      // Stray CRs or a mid-line CRLF: fall through to the field-by-field path.
    }

    // Field-by-field path (the record holds a quote, or stray CRs).
    const fields = [];
    let quoted = false;
    for (;;) {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        fields.push(readQuoted());
        if (fieldEnded !== COMMA) break;
        continue;
      }
      quoted = false;
      // The unquoted scan, inlined: two indexOf jumps and one slice, no call.
      const p = pos;
      const comma = text.indexOf(',', p);
      const lf = text.indexOf('\n', p);
      let end;
      let kind;
      if (comma !== -1 && (lf === -1 || comma < lf)) {
        end = comma;
        kind = COMMA;
      } else if (lf !== -1) {
        end = lf;
        kind = LB;
      } else {
        end = n;
        kind = END;
      }
      const chunk = text.slice(p, end);
      if (chunk.indexOf('\r') === -1) {
        fields.push(chunk);
        if (kind === COMMA) {
          pos = end + 1;
          continue;
        }
        if (kind === LB) {
          pos = end + 1;
          line += 1;
        } else {
          pos = end;
        }
        break;
      }
      if (kind === LB && chunk.charCodeAt(chunk.length - 1) === 13 && chunk.indexOf('\r') === chunk.length - 1) {
        // The only CR is the CRLF's, at the end of the line.
        fields.push(chunk.slice(0, -1));
        pos = end + 1;
        line += 1;
        break;
      }
      // Stray CRs (rare): the shared reader handles them and the errors.
      pos = p;
      fields.push(readUnquoted(''));
      if (fieldEnded !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;
    finish(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}

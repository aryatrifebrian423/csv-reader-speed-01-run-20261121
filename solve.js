// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference reader).
//
// Original implementation, written from the RULES.txt specification of
// csv-reader's broken-row semantics. It is NOT a copy of the vendor code:
// the vendor reads one character at a time and builds every field by
// repeated string concatenation; this reader instead slices fields out of
// the input whole — an unquoted field is scanned to its next delimiter and
// sliced, a quoted field is sliced to its closing quote — and only falls
// back to slow paths when a field actually contains a quote escape, a
// line break inside quotes, a stray CR, junk after a closing quote, or an
// unterminated quote. The observable behaviour is csv-reader's exactly:
//
//   - a U+FEFF at the very start is dropped;
//   - a record ends at LF or CRLF; a line with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field opening with a quote runs to the next quote that is not
//     doubled; "" inside it is one quote and each CRLF or lone CR inside
//     it reads as LF; what follows the closing quote up to the next comma
//     or line break is appended as it stands (quote_junk, when the field
//     ends); a quote that never closes is a literal and the text after it
//     is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character;
//   - fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows
//     hold the records after it, each padded (short_row, with fields: its
//     count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row} in the order met; line is the
//     1-based line its record starts on (every LF, CRLF and lone CR
//     inside quotes counted), row its record's index in rows (null for
//     the header).
//
// Field-end codes: 0 = comma (record goes on), 1 = line break (record
// ends), 2 = end of text (record ends).

// Reads unquoted characters from `pos` onto `prefix`, up to the next comma
// or line break, dropping a CR not followed by LF (one stray_cr error
// each). Returns [value, ended, pos, line, added] where `added` counts the
// characters this call kept (not the prefix). Used for junk after a closing
// quote and for re-reading after an unterminated quote.
function unquotedFrom(text, pos, line, prefix, errors, recordLine, recordRow) {
  const len = text.length;
  const ci = text.indexOf(',', pos);
  const ni = text.indexOf('\n', pos);
  let end;
  let ended;
  if (ci !== -1 && (ni === -1 || ci < ni)) { end = ci; ended = 0; }
  else if (ni !== -1) { end = ni; ended = 1; }
  else { end = len; ended = 2; }
  let fend = end;
  // A CR immediately before the LF is the CRLF ending the record, not
  // part of the field. Any other CR in the field is stray (a CR followed
  // by LF would itself be that first LF, so none can hide here).
  if (ended === 1 && end > pos && text.charCodeAt(end - 1) === 13) fend = end - 1;
  let seg = text.slice(pos, fend);
  if (seg.indexOf('\r') !== -1) {
    const parts = [];
    let last = 0;
    for (let i = 0; i < seg.length; i++) {
      if (seg.charCodeAt(i) === 13) {
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        parts.push(seg.slice(last, i));
        last = i + 1;
      }
    }
    parts.push(seg.slice(last));
    seg = parts.join('');
  }
  if (ended === 0) return [prefix + seg, 0, end + 1, line, seg.length];
  if (ended === 1) return [prefix + seg, 1, end + 1, line + 1, seg.length];
  return [prefix + seg, 2, len, line, seg.length];
}

// Slow path for a quoted field at `pos` (opening quote): doubled quotes,
// line breaks inside the quotes, an unterminated quote, or junk after the
// closing quote. Returns [value, ended, pos, line].
function quotedSlow(text, pos, line, errors, recordLine, recordRow) {
  const len = text.length;
  const open = pos;
  const openLine = line;
  let p = pos + 1;
  let l = line;
  let val = '';
  for (;;) {
    const q = text.indexOf('"', p);
    if (q === -1) {
      // The quote never closes: it is a literal, and the text after it is
      // read again as unquoted, from the line the field opened on.
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      const r = unquotedFrom(text, open + 1, openLine, '"', errors, recordLine, recordRow);
      return [r[0], r[1], r[2], r[3]];
    }
    // The segment up to the quote: CRLF and lone CR inside quotes each
    // read as one LF, and each counts as a line.
    let seg = text.slice(p, q);
    if (seg.indexOf('\r') !== -1 || seg.indexOf('\n') !== -1) {
      let out = '';
      let lines = 0;
      for (let i = 0; i < seg.length; i++) {
        const ch = seg.charCodeAt(i);
        if (ch === 13) {
          out += '\n';
          lines++;
          if (seg.charCodeAt(i + 1) === 10) i++;
        } else if (ch === 10) {
          out += '\n';
          lines++;
        } else {
          out += seg[i];
        }
      }
      seg = out;
      l += lines;
    }
    if (text.charCodeAt(q + 1) === 34) {
      // Doubled quote: one literal quote, keep scanning.
      val += seg;
      val += '"';
      p = q + 2;
      continue;
    }
    val += seg;
    const nc = q + 1;
    if (nc >= len) return [val, 2, len, l];
    const c = text.charCodeAt(nc);
    if (c === 44) return [val, 0, nc + 1, l];
    if (c === 10) return [val, 1, nc + 1, l + 1];
    if (c === 13 && text.charCodeAt(nc + 1) === 10) return [val, 1, nc + 2, l + 1];
    // What follows the closing quote is appended as it stands.
    const r = unquotedFrom(text, nc, l, val, errors, recordLine, recordRow);
    if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return [r[0], r[1], r[2], r[3]];
  }
}

/** csv-reader 1.0.0's answer for one case's input {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (len > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= len) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended = 0;
    let lastQuoted = false;
    do {
      let value;
      if (text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        // Fast quoted path: one closing quote, no escape, no line break
        // inside the quotes, and a clean end after it.
        const q = text.indexOf('"', pos + 1);
        if (q !== -1 && text.charCodeAt(q + 1) !== 34) {
          const seg = text.slice(pos + 1, q);
          if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
            const nc = q + 1;
            if (nc >= len) { value = seg; ended = 2; pos = len; }
            else {
              const c = text.charCodeAt(nc);
              if (c === 44) { value = seg; ended = 0; pos = nc + 1; }
              else if (c === 10) { value = seg; ended = 1; pos = nc + 1; line++; }
              else if (c === 13 && text.charCodeAt(nc + 1) === 10) { value = seg; ended = 1; pos = nc + 2; line++; }
              else {
                const r = unquotedFrom(text, nc, line, seg, errors, recordLine, recordRow);
                if (r[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
                value = r[0]; ended = r[1]; pos = r[2]; line = r[3];
              }
            }
          } else {
            const r = quotedSlow(text, pos, line, errors, recordLine, recordRow);
            value = r[0]; ended = r[1]; pos = r[2]; line = r[3];
          }
        } else {
          const r = quotedSlow(text, pos, line, errors, recordLine, recordRow);
          value = r[0]; ended = r[1]; pos = r[2]; line = r[3];
        }
      } else {
        lastQuoted = false;
        // Fast unquoted path: scan to the next comma, LF or CR and slice
        // the field out whole; a CR is the rare slow case (CRLF ends the
        // record, a lone CR is dropped with a stray_cr error each).
        let p = pos;
        let stray = -1;
        for (;;) {
          if (p >= len) { ended = 2; break; }
          const cc = text.charCodeAt(p);
          if (cc === 44) { ended = 0; break; }
          if (cc === 10) { ended = 1; break; }
          if (cc === 13) { stray = p; break; }
          p++;
        }
        if (stray !== -1) {
          if (text.charCodeAt(stray + 1) === 10) {
            value = text.slice(pos, stray);
            ended = 1;
            pos = stray + 2;
            line++;
          } else {
            const r = unquotedFrom(text, pos, line, '', errors, recordLine, recordRow);
            value = r[0]; ended = r[1]; pos = r[2]; line = r[3];
          }
        } else {
          value = text.slice(pos, p);
          if (ended === 0) pos = p + 1;
          else if (ended === 1) { pos = p + 1; line++; }
          else pos = len;
        }
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no
    // record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

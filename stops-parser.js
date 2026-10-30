/*
 * Parser for FTA STOPS (Simplified Trips-on-Project Software) report files.
 *
 * A STOPS report is a paginated fixed-width text file. Every page begins with
 * a four line header ("Program STOPS ...", "Version:", "Run:", "System:")
 * followed by a line identifying the page: "TABLE OF CONTENTS",
 * "SECTION n: ..." or "Table  n.nn". Each table occupies exactly one page.
 *
 * Within a table page, tabular data is laid out in fixed-width columns whose
 * extents are marked by a "rule" line made of runs of "=" or "-" characters.
 * Header lines sit above the rule (optionally with spanning "group" rules
 * between them) and data rows follow it.
 *
 * Works in the browser (exposes window.StopsParser) and in Node (module.exports).
 */
(function (root) {
  'use strict';

  var PAGE_START = /^Program STOPS\b/;
  var TABLE_LINE = /^Table\s+(\d+(?:\.\d+)?)\s*$/;
  var SECTION_LINE = /^SECTION\s+(\d+)\s*:\s*(.*?)\s*$/;
  var NUMERIC = /^[-+]?(?:\d[\d,]*\.?\d*|\.\d+)%?$|^-$/;

  /* ------------------------------------------------------------------ */
  /* Report level parsing                                                */
  /* ------------------------------------------------------------------ */

  function parseReport(text) {
    var lines = text.split(/\r?\n/);
    for (var n = 0; n < lines.length; n++) {
      if (lines[n].indexOf('\f') !== -1) lines[n] = lines[n].replace(/\f/g, '');
    }

    var pageStarts = [];
    for (var i = 0; i < lines.length; i++) {
      if (PAGE_START.test(lines[i])) pageStarts.push(i);
    }
    if (!pageStarts.length || pageStarts[0] > 5) {
      throw new Error('This file does not look like a STOPS report (no "Program STOPS" page header was found).');
    }

    var report = {
      meta: parseMeta(lines, pageStarts[0]),
      sections: [],
      tables: [],
      byId: Object.create(null),
      tocLines: []
    };

    var currentSection = null;
    for (var p = 0; p < pageStarts.length; p++) {
      var start = pageStarts[p];
      var end = p + 1 < pageStarts.length ? pageStarts[p + 1] : lines.length;
      var kind = (lines[start + 4] || '').trim();
      var body = trimBody(lines.slice(start + 5, end));
      var m;

      if (/^TABLE OF CONTENTS/i.test(kind)) {
        report.tocLines = body;
      } else if ((m = SECTION_LINE.exec(kind))) {
        currentSection = { number: parseInt(m[1], 10), title: m[2], tables: [] };
        report.sections.push(currentSection);
      } else if ((m = TABLE_LINE.exec(kind))) {
        if (!currentSection) {
          currentSection = { number: 0, title: 'Tables', tables: [] };
          report.sections.push(currentSection);
        }
        var table = {
          id: m[1],
          index: report.tables.length,
          section: currentSection,
          body: body,
          title: '',
          description: describe(body),
          page: p + 1
        };
        currentSection.tables.push(table);
        report.tables.push(table);
        report.byId[table.id] = table;
      }
    }

    var tocTitles = parseTocTitles(report.tocLines);
    report.tables.forEach(function (t) {
      t.title = tocTitles[t.id] || t.description || 'Table ' + t.id;
    });
    report.sections = report.sections.filter(function (s) { return s.tables.length; });

    return report;
  }

  function parseMeta(lines, start) {
    function split(line, prefix) {
      return (line || '').replace(prefix, '').trim().split(/\s{2,}/);
    }
    var l1 = split(lines[start], /^$/);
    var l2 = split(lines[start + 1], /^Version:/);
    var l3 = split(lines[start + 2], /^Run:/);
    return {
      program: l1[0] || '',
      version: l2[0] || '',
      date: l2[1] || '',
      run: l3[0] || '',
      time: l3[1] || '',
      system: (lines[start + 3] || '').replace(/^System:/, '').trim()
    };
  }

  /* Remove leading/trailing blank lines and trailing full-width page rules. */
  function trimBody(body) {
    var end = body.length;
    while (end > 0) {
      var l = body[end - 1];
      if (isBlank(l) || /^\s*[=\-]{60,}\s*$/.test(l)) end--;
      else break;
    }
    var start = 0;
    while (start < end && isBlank(body[start])) start++;
    return body.slice(start, end);
  }

  /*
   * Titles from the report's own table of contents. Lines look like
   *   "   Station Listing:                                  1.02"
   * and in Section 14 like
   *   "   Build Trips for ...:   14.01   14.09   14.17   14.25"
   * with a column header line ("Walk  KNR  PNR  All Acc") above them.
   */
  function parseTocTitles(tocLines) {
    var titles = Object.create(null);
    var columnHeader = null;
    tocLines.forEach(function (line) {
      var tail = /(\s+\d+\.\d+)+\s*$/.exec(line);
      if (!tail) {
        if (/^\s{20,}\S/.test(line) && /[A-Za-z]/.test(line)) columnHeader = line;
        else if (!/^\s*-+(\s+-+)*\s*$/.test(line)) columnHeader = null;
        return;
      }
      var label = line.slice(0, tail.index).trim().replace(/:$/, '').trim();
      if (!/[A-Za-z]{3,}/.test(label) || /\b\d+\.\d+$/.test(label)) return;
      var nums = [];
      var re = /\d+\.\d+/g;
      var mm;
      while ((mm = re.exec(line))) {
        if (mm.index >= tail.index) nums.push({ id: mm[0], s: mm.index, e: mm.index + mm[0].length - 1 });
      }
      // Rows of the Section 15 matrix ("Existing  HBW  0  15.01 16.01 ...")
      // have no usable label; their titles come from the table content.
      if (nums.length > 1 && !columnHeader) return;
      nums.forEach(function (n) {
        var t = label;
        if (nums.length > 1) {
          var h = columnHeader.slice(Math.max(0, n.s - 2), n.e + 3).trim();
          if (h) t += ' (' + h + ')';
        }
        titles[n.id] = t;
      });
    });
    return titles;
  }

  /* Short description of a table from its leading text lines. */
  function describe(body) {
    var out = [];
    for (var i = 0; i < body.length && out.length < 3; i++) {
      var l = body[i];
      if (isBlank(l)) continue;
      if (isRule(l)) {
        if (runsOf(l).length > 1) break;
        continue;
      }
      var j = i + 1;
      while (j < body.length && j <= i + 2 && isBlank(body[j])) j++;
      if (j < body.length && isRule(body[j]) && runsOf(body[j]).length > 1) break;
      var clean = cleanText(l);
      if (clean) out.push(clean);
    }
    return out.join(' — ');
  }

  function cleanText(s) {
    return s.replace(/^[\s*]+|[\s*]+$/g, '').replace(/\s+/g, ' ');
  }

  /* ------------------------------------------------------------------ */
  /* Table body parsing                                                  */
  /* ------------------------------------------------------------------ */

  function isBlank(l) {
    return !l || /^\s*$/.test(l);
  }

  function isRule(l) {
    return /^[\s=\-|]*$/.test(l) && /[=\-]{2,}/.test(l);
  }

  function runsOf(l) {
    var r = [];
    var re = /[=\-]+/g;
    var m;
    while ((m = re.exec(l))) r.push({ s: m.index, e: m.index + m[0].length - 1 });
    return r;
  }

  function wordsOf(l) {
    var w = [];
    var re = /\S+/g;
    var m;
    l = l.replace(/\|/g, ' ');
    while ((m = re.exec(l))) w.push({ t: m[0], s: m.index, e: m.index + m[0].length - 1 });
    return w;
  }

  /* Phrases separated by two or more spaces (or a "|" divider). */
  function segmentsOf(l) {
    var segs = [];
    var re = /\S+(?: \S+)*/g;
    var m;
    l = l.replace(/\|/g, ' ');
    while ((m = re.exec(l))) segs.push({ t: m[0], s: m.index, e: m.index + m[0].length - 1 });
    return segs;
  }

  function overlap(a, b) {
    return Math.max(0, Math.min(a.e, b.e) - Math.max(a.s, b.s) + 1);
  }

  /*
   * Split a table page into an ordered list of blocks:
   *   { type: 'text', lines: [...] }
   *   { type: 'grid', caption: [...], columns: [...], headerRows: [...], rows: [...] }
   */
  function parseTable(body) {
    var blocks = [];
    var text = [];
    var grid = null;
    var n = body.length;

    function flushText() {
      var t = trimBlankLines(text);
      if (t.length) blocks.push({ type: 'text', lines: t });
      text = [];
    }

    for (var i = 0; i < n; i++) {
      var l = body[i];

      if (grid) {
        if (isBlank(l)) {
          var j = i + 1;
          while (j < n && isBlank(body[j])) j++;
          if (j < n && continuesAfterBlank(body[j], grid)) {
            grid.raw.push(null); // row-group break
            i = j - 1;
            continue;
          }
          finishGrid(grid);
          grid = null;
          text.push(l);
          continue;
        }
        if (isRule(l)) {
          var r = runsOf(l);
          if (r.length > 1 || r[0].e - r[0].s > 20) {
            grid.raw.push(null);
            continue;
          }
        }
        if (grid.raw.some(Boolean) && !/^\s*\*\*\*/.test(l) && isTexty(l, grid.colRuns)) {
          finishGrid(grid);
          grid = null;
          text.push(l);
          continue;
        }
        grid.raw.push(l);
        continue;
      }

      if (isRule(l) && runsOf(l).length > 1) {
        var started = startGrid(body, i, text);
        if (started) {
          text = started.remainingText;
          flushText();
          grid = started.grid;
          blocks.push(grid);
          i = started.nextIndex - 1;
          continue;
        }
      }
      text.push(l);
    }
    if (grid) finishGrid(grid);
    flushText();

    // A rule with no data beneath it is not a table: turn it back into text.
    var out = [];
    blocks.forEach(function (b) {
      if (b.type === 'grid' && !b.rows.length) {
        var lines = b.captionLines.concat(b.headerSource);
        var prev = out[out.length - 1];
        if (prev && prev.type === 'text') prev.lines = prev.lines.concat(lines);
        else out.push({ type: 'text', lines: lines });
      } else {
        out.push(b);
      }
    });
    return out;
  }

  function trimBlankLines(lines) {
    var s = 0;
    var e = lines.length;
    while (s < e && isBlank(lines[s])) s++;
    while (e > s && isBlank(lines[e - 1])) e--;
    return lines.slice(s, e);
  }

  /*
   * Begin a grid at rule line index i. The rule at i may be a "group" rule
   * spanning several columns, in which case the real column rule lies a few
   * lines further down with more runs.
   */
  function startGrid(body, i, text) {
    var colIndex = i;
    var isGroup = false;

    for (;;) {
      var runs = runsOf(body[colIndex]);
      var found = -1;
      for (var k = colIndex + 1; k < body.length && k <= colIndex + 4; k++) {
        if (isBlank(body[k])) break;
        if (isRule(body[k])) {
          if (runsOf(body[k]).length > runs.length && k > colIndex + 1) found = k;
          break;
        }
      }
      if (found < 0) break;
      if (colIndex === i) isGroup = true;
      colIndex = found;
    }
    var colRuns = runsOf(body[colIndex]);
    if (colIndex + 1 >= body.length) return null;

    var between = body.slice(i, colIndex);

    // Header lines above the first rule, taken from the pending text.
    var above = [];
    var t = text.slice();
    var idx = t.length - 1;
    if (idx > 0 && isBlank(t[idx]) && !isBlank(t[idx - 1])) idx--;
    var maxAbove = isGroup ? 1 : 4;
    while (idx >= 0 && above.length < maxAbove) {
      var line = t[idx];
      if (isBlank(line) || isRule(line)) break;
      if (above.length > 0 && !isHeaderLike(line, colRuns)) break;
      above.unshift(line);
      idx--;
    }
    var remaining = t.slice(0, idx + 1);

    // Header list, attaching each group rule to the line above it.
    var header = [];
    var src = above.concat(between);
    src.forEach(function (line) {
      if (isRule(line)) {
        if (header.length) header[header.length - 1].groupRuns = runsOf(line);
        return;
      }
      if (isBlank(line)) return;
      // "=====" runs sharing a line with header text underline the line above.
      var inlineRuns = segmentsOf(line).filter(function (s) { return /^[=\-]{3,}$/.test(s.t); });
      if (inlineRuns.length && header.length) {
        var prev = header[header.length - 1];
        prev.groupRuns = (prev.groupRuns || []).concat(inlineRuns.map(function (s) { return { s: s.s, e: s.e }; }));
        inlineRuns.forEach(function (s) {
          line = line.slice(0, s.s) + new Array(s.e - s.s + 2).join(' ') + line.slice(s.e + 1);
        });
        if (isBlank(line)) return;
      }
      header.push({ line: line, groupRuns: null });
    });

    // Caption: the short run of text lines directly above the headers.
    var capEnd = remaining.length;
    while (capEnd > 0 && isBlank(remaining[capEnd - 1])) capEnd--;
    var capStart = capEnd;
    while (capStart > 0 && !isBlank(remaining[capStart - 1]) && !isRule(remaining[capStart - 1])) capStart--;
    var captionLines = [];
    if (capEnd > capStart && capEnd - capStart <= 4) {
      captionLines = remaining.slice(capStart, capEnd);
      remaining = remaining.slice(0, capStart);
    }

    return {
      grid: {
        type: 'grid',
        colRuns: colRuns,
        header: header,
        headerSource: src.concat([body[colIndex]]),
        captionLines: captionLines,
        caption: captionLines.map(cleanText).filter(Boolean),
        raw: []
      },
      remainingText: remaining,
      nextIndex: colIndex + 1
    };
  }

  /*
   * Whether a line above the column rule looks like a header rather than a
   * title. Titles start in the first column and run on across columns.
   */
  function isHeaderLike(line, colRuns) {
    var segs = segmentsOf(line);
    if (!segs.length) return false;
    var first = segs[0];
    var c0 = colRuns[0];
    if (first.s > c0.e) return true;
    if (first.e <= c0.e + 1) return true;
    var crossed = 0;
    for (var c = 1; c < colRuns.length; c++) {
      if (first.e >= colRuns[c].s - 1 && first.s < colRuns[c].s) crossed++;
    }
    return crossed <= 1 && segs.length >= 2;
  }

  /* Number of inter-column gaps a line writes characters into. */
  function gapHits(line, colRuns) {
    var hits = 0;
    var l = line.replace(/\|/g, ' ');
    for (var c = 0; c + 1 < colRuns.length; c++) {
      for (var p = colRuns[c].e + 1; p < colRuns[c + 1].s; p++) {
        if (p < l.length && l[p] !== ' ') {
          hits++;
          break;
        }
      }
    }
    return hits;
  }

  function alphaWords(line) {
    return wordsOf(line).filter(function (w) { return /[A-Za-z]{2,}/.test(w.t); }).length;
  }

  function numericWords(line) {
    return wordsOf(line).filter(function (w) { return NUMERIC.test(w.t.replace(/:$/, '')); }).length;
  }

  /* Prose (mostly words, few numbers) running across the columns ends a grid. */
  function isTexty(line, colRuns) {
    if (/^[\s.]+$/.test(line)) return true;
    var alpha = alphaWords(line);
    return alpha >= 4 && alpha > 2 * numericWords(line) && gapHits(line, colRuns) >= 1;
  }

  function continuesAfterBlank(line, grid) {
    if (isRule(line)) return false;
    if (isTexty(line, grid.colRuns)) return false;
    var w = wordsOf(line);
    if (w.length < 2) return false;
    var nums = w.filter(function (x) { return NUMERIC.test(x.t); }).length;
    return nums / w.length >= 0.25;
  }

  /* Convert a grid's raw lines into columns, header rows and data rows. */
  function finishGrid(grid) {
    var cols = grid.colRuns.map(function (r) { return { s: r.s, e: r.e }; });
    var last = cols[cols.length - 1];
    var first = cols[0];

    // Additional columns for data appearing to the right of the last rule run.
    var extras = [];
    grid.raw.forEach(function (l) {
      if (l === null) return;
      wordsOf(l).forEach(function (w) {
        if (w.s > last.e + 1) extras.push({ s: w.s, e: w.e });
      });
    });
    extras.sort(function (a, b) { return a.s - b.s; });
    var merged = [];
    extras.forEach(function (x) {
      var m = merged[merged.length - 1];
      if (m && x.s <= m.e + 1) m.e = Math.max(m.e, x.e);
      else merged.push({ s: x.s, e: x.e });
    });
    cols = cols.concat(merged);

    function assign(w) {
      var best = -1;
      var bestOv = 0;
      for (var c = 0; c < cols.length; c++) {
        var ov = overlap(w, cols[c]);
        if (ov > bestOv) { bestOv = ov; best = c; }
      }
      if (best >= 0) return best;
      if (w.e < first.s) return 0;
      // In a gap: numbers are right aligned so lean right; text leans left.
      var numeric = NUMERIC.test(w.t);
      var bestD = Infinity;
      for (var d = 0; d < cols.length; d++) {
        var dist = w.e < cols[d].s ? cols[d].s - w.e : w.s - cols[d].e;
        if (dist < bestD || (dist === bestD && numeric)) { bestD = dist; best = d; }
      }
      return best;
    }

    var rows = [];
    var group = 0;
    grid.raw.forEach(function (l) {
      if (l === null) {
        if (rows.length && rows[rows.length - 1].group === group) group++;
        return;
      }
      var cells = cols.map(function () { return []; });
      wordsOf(l).forEach(function (w) { cells[assign(w)].push(w.t); });
      var texts = cells.map(function (c) { return c.join(' '); });
      if (texts.some(Boolean)) rows.push({ cells: texts, group: group });
    });

    var headerRows = grid.header.map(function (h) {
      return buildHeaderRow(h, cols);
    });

    // Drop columns with no data and no header of their own.
    var keep = cols.map(function (c, ci) {
      if (rows.some(function (r) { return r.cells[ci]; })) return true;
      return headerRows.some(function (hr) {
        return hr.some(function (cell) {
          return cell.text && cell.span === 1 && cell.start === ci;
        });
      });
    });
    if (keep.indexOf(false) !== -1) {
      var map = [];
      var k = 0;
      keep.forEach(function (on) { map.push(on ? k++ : -1); });
      cols = cols.filter(function (c, ci) { return keep[ci]; });
      rows.forEach(function (r) {
        r.cells = r.cells.filter(function (c, ci) { return keep[ci]; });
      });
      headerRows = headerRows.map(function (hr) {
        var out = [];
        hr.forEach(function (cell) {
          var s = -1;
          var e = -1;
          for (var ci = cell.start; ci < cell.start + cell.span; ci++) {
            if (map[ci] >= 0) {
              if (s < 0) s = map[ci];
              e = map[ci];
            }
          }
          if (s >= 0) out.push({ text: cell.text, start: s, span: e - s + 1 });
        });
        return fillRow(out, cols.length);
      });
    }

    // Numeric columns are right aligned.
    var numericCols = cols.map(function (c, ci) {
      var filled = 0;
      var nums = 0;
      rows.forEach(function (r) {
        var v = r.cells[ci];
        if (v) {
          filled++;
          if (NUMERIC.test(v)) nums++;
        }
      });
      return filled > 0 && nums / filled >= 0.6;
    });

    grid.columns = cols.map(function (c, ci) { return { numeric: numericCols[ci] }; });
    grid.headerRows = headerRows.filter(function (hr) {
      return hr.some(function (c) { return c.text; });
    });
    grid.rows = rows;
    grid.rowHeaderColumn = !numericCols[0] && rows.length > 0 &&
      rows.filter(function (r) { return r.cells[0]; }).length / rows.length >= 0.5;
    delete grid.raw;
  }

  function buildHeaderRow(h, cols) {
    var line = h.line.replace(/\|/g, ' ');
    var cells = [];

    function colsOverlapping(span) {
      var s = -1;
      var e = -1;
      for (var c = 0; c < cols.length; c++) {
        if (overlap(span, cols[c]) > 0) {
          if (s < 0) s = c;
          e = c;
        }
      }
      if (s < 0) {
        var bestD = Infinity;
        for (var d = 0; d < cols.length; d++) {
          var dist = span.e < cols[d].s ? cols[d].s - span.e : span.s - cols[d].e;
          if (dist < bestD) { bestD = dist; s = e = d; }
        }
      }
      return { start: s, span: e - s + 1 };
    }

    var segs = segmentsOf(line);

    if (h.groupRuns) {
      var runs = h.groupRuns;
      var perRun = runs.map(function () { return []; });
      var loose = [];
      segs.forEach(function (seg) {
        var best = -1;
        var bestOv = 0;
        runs.forEach(function (r, ri) {
          var ov = overlap(seg, r);
          if (ov > bestOv) { bestOv = ov; best = ri; }
        });
        if (best >= 0) perRun[best].push(seg.t);
        else loose.push(seg);
      });
      runs.forEach(function (r, ri) {
        var pos = colsOverlapping(r);
        cells.push({ text: perRun[ri].join(' '), start: pos.start, span: pos.span });
      });
      loose.forEach(function (seg) {
        var pos = colsOverlapping(seg);
        cells.push({ text: seg.t, start: pos.start, span: pos.span });
      });
    } else {
      segs.forEach(function (seg) {
        var words = wordsOf(seg.t).map(function (w) {
          return { t: w.t, s: w.s + seg.s, e: w.e + seg.s };
        });
        // A segment whose words each sit inside their own column is a run
        // of single-space separated headings; otherwise it spans columns.
        var targets = words.map(function (w) {
          for (var c = 0; c < cols.length; c++) {
            if (w.s >= cols[c].s - 1 && w.e <= cols[c].e + 1) return c;
          }
          return -1;
        });
        var ordered = targets.every(function (t, ti) {
          return t >= 0 && (ti === 0 || t >= targets[ti - 1]);
        });
        if (words.length > 1 && ordered && targets[0] !== targets[targets.length - 1]) {
          words.forEach(function (w, wi) {
            var prevCell = cells[cells.length - 1];
            if (wi > 0 && targets[wi] === targets[wi - 1]) prevCell.text += ' ' + w.t;
            else cells.push({ text: w.t, start: targets[wi], span: 1 });
          });
        } else {
          var pos = colsOverlapping(seg);
          cells.push({ text: seg.t, start: pos.start, span: pos.span });
        }
      });
    }

    // Merge cells that claim the same columns.
    cells.sort(function (a, b) { return a.start - b.start; });
    var merged = [];
    cells.forEach(function (c) {
      var m = merged[merged.length - 1];
      if (m && c.start <= m.start + m.span - 1) {
        var end = Math.max(m.start + m.span, c.start + c.span);
        if (c.text) m.text = m.text ? m.text + ' ' + c.text : c.text;
        m.span = end - m.start;
      } else {
        merged.push({ text: c.text, start: c.start, span: c.span });
      }
    });
    merged.forEach(function (c) {
      if (/[A-Za-z0-9]/.test(c.text)) c.text = c.text.replace(/^[-=]{2,}\s*|\s*[-=]{2,}$/g, '');
    });
    return fillRow(merged, cols.length);
  }

  /* Fill gaps in a header row with empty single-column cells. */
  function fillRow(cells, ncols) {
    var out = [];
    var pos = 0;
    cells.forEach(function (c) {
      while (pos < c.start) out.push({ text: '', start: pos++, span: 1 });
      out.push(c);
      pos = c.start + c.span;
    });
    while (pos < ncols) out.push({ text: '', start: pos++, span: 1 });
    return out;
  }

  var api = {
    parseReport: parseReport,
    parseTable: parseTable,
    isNumeric: function (s) { return NUMERIC.test(s); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StopsParser = api;
})(this);

/*
 * STOPS Report Viewer: tabbed interface, table of contents and table views.
 * Accessibility notes:
 *  - Tabs follow the WAI-ARIA Authoring Practices tabs pattern (roving
 *    tabindex, arrow/Home/End keys, automatic activation, Delete to close).
 *  - Focus moves to the table heading when a table opens, and back to the
 *    table of contents entry when it closes.
 *  - Data tables use caption, th with scope, and headers/id for multi-row
 *    headers; scrollable tables are focusable named regions.
 *  - Status changes are announced through a polite live region.
 */
(function () {
  'use strict';

  var files = [];
  var activeFile = null;
  var nextFileId = 1;
  var renderCounter = 0;

  var els = {
    openButton: document.getElementById('open-button'),
    fileInput: document.getElementById('file-input'),
    status: document.getElementById('status'),
    alert: document.getElementById('alert'),
    workspace: document.getElementById('workspace'),
    tablist: document.getElementById('tablist'),
    panels: document.getElementById('panels'),
    empty: document.getElementById('empty-state'),
    dropZone: document.getElementById('drop-zone')
  };

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function announce(msg) {
    // Clear first so repeated identical messages are still announced.
    els.status.textContent = '';
    window.setTimeout(function () { els.status.textContent = msg; }, 50);
  }

  function showError(msg) {
    els.alert.textContent = msg;
    els.alert.hidden = false;
  }

  function clearError() {
    els.alert.hidden = true;
    els.alert.textContent = '';
  }

  function plural(n, word) {
    return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's');
  }

  function sectionLabel(section) {
    return section.number ? 'Section ' + section.number + ': ' + section.title : section.title;
  }

  function updateDocumentTitle() {
    var parts = [];
    if (activeFile) {
      if (activeFile.currentTable) parts.push('Table ' + activeFile.currentTable.id);
      parts.push(activeFile.name);
    }
    parts.push('STOPS Report Viewer');
    document.title = parts.join(' – ');
  }

  /* ------------------------------------------------------------------ */
  /* Opening files                                                       */
  /* ------------------------------------------------------------------ */

  els.openButton.addEventListener('click', function () {
    els.fileInput.click();
  });

  els.fileInput.addEventListener('change', function () {
    openFiles(els.fileInput.files);
    els.fileInput.value = '';
  });

  // Drag and drop anywhere on the page.
  document.addEventListener('dragover', function (e) {
    if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) {
      e.preventDefault();
      els.dropZone.classList.add('dragging');
    }
  });
  document.addEventListener('dragleave', function (e) {
    if (e.target === document.documentElement || e.relatedTarget === null) {
      els.dropZone.classList.remove('dragging');
    }
  });
  document.addEventListener('drop', function (e) {
    els.dropZone.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files.length) {
      e.preventDefault();
      openFiles(e.dataTransfer.files);
    }
  });

  function openFiles(fileList) {
    var list = Array.prototype.slice.call(fileList || []);
    if (!list.length) return;
    clearError();
    var errors = [];
    var opened = [];

    var chain = Promise.resolve();
    list.forEach(function (file) {
      chain = chain.then(function () {
        announce('Loading ' + file.name + '…');
        return readFile(file).then(function (text) {
          // Yield so the loading message can render before parsing.
          return new Promise(function (resolve) {
            window.setTimeout(function () {
              try {
                var report = StopsParser.parseReport(text);
                if (!report.tables.length) throw new Error('No tables were found in this file.');
                opened.push(addFile(file.name, report));
              } catch (err) {
                errors.push(file.name + ': ' + err.message);
              }
              resolve();
            }, 30);
          });
        }, function () {
          errors.push(file.name + ': the file could not be read.');
        });
      });
    });

    chain.then(function () {
      if (errors.length) showError('Some files could not be opened. ' + errors.join(' '));
      if (opened.length) {
        var last = opened[opened.length - 1];
        selectFile(last, true);
        announce('Opened ' + opened.map(function (f) {
          return f.name + ' (' + plural(f.report.tables.length, 'table') + ')';
        }).join(', ') + '.');
      } else if (!errors.length) {
        announce('');
      }
    });
  }

  function readFile(file) {
    if (file.arrayBuffer && window.TextDecoder) {
      return file.arrayBuffer().then(function (buf) {
        return new TextDecoder('windows-1252').decode(buf);
      });
    }
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file, 'windows-1252');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Tabs                                                                */
  /* ------------------------------------------------------------------ */

  function uniqueName(name) {
    var taken = files.map(function (f) { return f.name; });
    if (taken.indexOf(name) === -1) return name;
    for (var n = 2; ; n++) {
      var candidate = name + ' (' + n + ')';
      if (taken.indexOf(candidate) === -1) return candidate;
    }
  }

  function addFile(name, report) {
    var id = nextFileId++;
    var f = {
      id: id,
      name: uniqueName(name),
      report: report,
      currentTable: null,
      returnFocus: null,
      tocScroll: 0
    };

    var tab = document.createElement('button');
    tab.type = 'button';
    tab.id = 'tab-' + id;
    tab.className = 'tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', 'false');
    tab.setAttribute('aria-controls', 'panel-' + id);
    tab.setAttribute('aria-describedby', 'tab-help');
    tab.tabIndex = -1;
    tab.innerHTML = '<span class="tab-label">' + esc(f.name) + '</span>' +
      '<span class="tab-close" aria-hidden="true" title="Close ' + esc(f.name) + '">×</span>';
    tab.addEventListener('click', function (e) {
      if (e.target.classList.contains('tab-close')) {
        closeFile(f);
      } else {
        selectFile(f, false);
      }
    });
    els.tablist.appendChild(tab);
    f.tab = tab;

    var panel = document.createElement('div');
    panel.id = 'panel-' + id;
    panel.className = 'tabpanel';
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', 'tab-' + id);
    panel.tabIndex = 0;
    panel.hidden = true;
    els.panels.appendChild(panel);
    f.panel = panel;

    buildPanel(f);
    files.push(f);
    els.workspace.hidden = false;
    els.empty.hidden = true;
    return f;
  }

  function selectFile(f, moveFocus) {
    if (activeFile && activeFile !== f && !activeFile.currentTable) {
      activeFile.tocScroll = window.scrollY;
    }
    files.forEach(function (other) {
      var on = other === f;
      other.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      other.tab.tabIndex = on ? 0 : -1;
      other.panel.hidden = !on;
    });
    activeFile = f;
    if (moveFocus) f.tab.focus();
    updateDocumentTitle();
  }

  function closeFile(f) {
    var idx = files.indexOf(f);
    if (idx === -1) return;
    f.tab.remove();
    f.panel.remove();
    files.splice(idx, 1);
    if (activeFile === f) activeFile = null;

    if (files.length) {
      var next = files[Math.min(idx, files.length - 1)];
      selectFile(next, false);
      next.tab.focus();
    } else {
      els.workspace.hidden = true;
      els.empty.hidden = false;
      updateDocumentTitle();
      els.openButton.focus();
    }
    announce('Closed ' + f.name + '.');
  }

  els.tablist.addEventListener('keydown', function (e) {
    var idx = files.findIndex(function (f) { return f.tab === document.activeElement; });
    if (idx === -1) return;
    var target = null;
    switch (e.key) {
      case 'ArrowRight': target = files[(idx + 1) % files.length]; break;
      case 'ArrowLeft': target = files[(idx - 1 + files.length) % files.length]; break;
      case 'Home': target = files[0]; break;
      case 'End': target = files[files.length - 1]; break;
      case 'Delete':
        e.preventDefault();
        closeFile(files[idx]);
        return;
      default: return;
    }
    e.preventDefault();
    selectFile(target, true);
  });

  /* ------------------------------------------------------------------ */
  /* Panel: file header, table of contents and table view                */
  /* ------------------------------------------------------------------ */

  function buildPanel(f) {
    var r = f.report;
    var m = r.meta;
    var p = 'f' + f.id;

    var metaItems = [];
    if (m.system) metaItems.push(['System', m.system]);
    if (m.run) metaItems.push(['Run', m.run]);
    if (m.version) metaItems.push(['STOPS version', m.version]);
    if (m.date || m.time) metaItems.push(['Run date', (m.date + ' ' + m.time).trim()]);
    metaItems.push(['Tables', r.tables.length.toLocaleString()]);

    f.panel.innerHTML =
      '<div class="file-header">' +
        '<div>' +
          '<h2 class="file-title">' + esc(f.name) + '</h2>' +
          '<dl class="file-meta">' + metaItems.map(function (it) {
            return '<div><dt>' + esc(it[0]) + '</dt><dd>' + esc(it[1]) + '</dd></div>';
          }).join('') + '</dl>' +
        '</div>' +
        '<button type="button" class="button close-file">Close file<span class="visually-hidden"> ' + esc(f.name) + '</span></button>' +
      '</div>' +

      '<div class="toc-view">' +
        '<h3 id="' + p + '-toc-heading" tabindex="-1">Table of contents</h3>' +
        '<div class="toc-tools">' +
          '<div class="filter-field">' +
            '<label for="' + p + '-filter">Filter tables by number or title</label>' +
            '<input type="search" id="' + p + '-filter" class="filter-input" autocomplete="off" aria-describedby="' + p + '-filter-count">' +
          '</div>' +
          '<div class="toc-buttons">' +
            '<button type="button" class="button expand-all">Expand all sections</button>' +
            '<button type="button" class="button collapse-all">Collapse all sections</button>' +
          '</div>' +
        '</div>' +
        '<p id="' + p + '-filter-count" class="filter-count" aria-live="polite">' + esc(plural(r.tables.length, 'table')) + ' in ' + esc(plural(r.sections.length, 'section')) + '.</p>' +
        '<nav aria-labelledby="' + p + '-toc-heading">' + buildToc(f) + '</nav>' +
      '</div>' +

      '<div class="table-view" hidden>' +
        '<div class="table-toolbar" role="group" aria-label="Table navigation">' +
          '<button type="button" class="button button-primary back-to-toc">' +
            '<span aria-hidden="true">← </span>Back to table of contents</button>' +
          '<button type="button" class="button prev-table">Previous table</button>' +
          '<button type="button" class="button next-table">Next table</button>' +
          '<button type="button" class="button toggle-raw" aria-expanded="false" aria-controls="' + p + '-raw">Show original report text</button>' +
        '</div>' +
        '<p class="table-section"></p>' +
        '<h3 class="table-title" id="' + p + '-table-title" tabindex="-1"></h3>' +
        '<p class="table-desc"></p>' +
        '<div class="table-content"></div>' +
        '<div class="raw-wrap" id="' + p + '-raw" hidden>' +
          '<h4>Original report text</h4>' +
          '<div class="raw-scroll" role="region" tabindex="0" aria-label="Original report text">' +
            '<pre class="raw-text"></pre>' +
          '</div>' +
        '</div>' +
      '</div>';

    var q = function (sel) { return f.panel.querySelector(sel); };
    f.view = {
      toc: q('.toc-view'),
      tocHeading: q('#' + p + '-toc-heading'),
      filter: q('.filter-input'),
      filterCount: q('.filter-count'),
      table: q('.table-view'),
      title: q('.table-title'),
      section: q('.table-section'),
      desc: q('.table-desc'),
      content: q('.table-content'),
      prev: q('.prev-table'),
      next: q('.next-table'),
      rawToggle: q('.toggle-raw'),
      rawWrap: q('.raw-wrap'),
      raw: q('.raw-text')
    };
    f.tocItems = Array.prototype.slice.call(f.panel.querySelectorAll('.toc-item'));
    f.tocDetails = Array.prototype.slice.call(f.panel.querySelectorAll('details.toc-section'));
    f.searchText = r.tables.map(function (t) {
      return (t.id + ' ' + t.title + ' ' + t.description).toLowerCase();
    });

    q('.close-file').addEventListener('click', function () { closeFile(f); });

    f.panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-table-id]');
      if (btn && f.panel.contains(btn)) {
        var t = r.byId[btn.getAttribute('data-table-id')];
        if (t) {
          if (!f.currentTable) {
            f.returnFocus = btn;
            f.tocScroll = window.scrollY;
          }
          showTable(f, t);
        }
      }
    });

    q('.expand-all').addEventListener('click', function () {
      f.tocDetails.forEach(function (d) { if (!d.hidden) d.open = true; });
    });
    q('.collapse-all').addEventListener('click', function () {
      f.tocDetails.forEach(function (d) { d.open = false; });
    });

    var timer = null;
    f.view.filter.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () { applyFilter(f); }, 200);
    });

    q('.back-to-toc').addEventListener('click', function () { closeTable(f); });
    f.view.prev.addEventListener('click', function () { stepTable(f, -1); });
    f.view.next.addEventListener('click', function () { stepTable(f, 1); });
    f.view.rawToggle.addEventListener('click', function () {
      var show = f.view.rawWrap.hidden;
      f.view.rawWrap.hidden = !show;
      f.view.rawToggle.setAttribute('aria-expanded', show ? 'true' : 'false');
      f.view.rawToggle.textContent = show ? 'Hide original report text' : 'Show original report text';
    });

    f.view.table.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeTable(f);
      }
    });
  }

  function buildToc(f) {
    var r = f.report;
    var html = '<ul class="toc-sections">';
    r.sections.forEach(function (s, si) {
      var count = s.tables.length;
      // Open small sections by default; very large ones start collapsed.
      var open = count <= 40 ? ' open' : '';
      html += '<li><details class="toc-section" data-section="' + si + '"' + open + '>' +
        '<summary><span class="section-name">' + esc(sectionLabel(s)) + '</span> ' +
        '<span class="section-count">(<span class="section-count-n">' + esc(plural(count, 'table')) + '</span>)</span></summary>' +
        '<ul class="toc-list">';
      s.tables.forEach(function (t) {
        var showDesc = t.description && t.description !== t.title;
        html += '<li class="toc-entry" data-index="' + t.index + '">' +
          '<button type="button" class="toc-item" data-table-id="' + esc(t.id) + '">' +
            '<span class="toc-num">Table ' + esc(t.id) + '</span>' +
            '<span class="toc-title">' + esc(t.title) + '</span>' +
            (showDesc ? '<span class="toc-desc">' + esc(t.description) + '</span>' : '') +
          '</button></li>';
      });
      html += '</ul></details></li>';
    });
    return html + '</ul>';
  }

  function applyFilter(f) {
    var terms = f.view.filter.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    var total = 0;
    var sectionCounts = f.report.sections.map(function () { return 0; });
    var sectionIndex = Object.create(null);
    f.report.sections.forEach(function (s, si) {
      s.tables.forEach(function (t) { sectionIndex[t.index] = si; });
    });

    f.tocItems.forEach(function (btn) {
      var li = btn.parentNode;
      var idx = +li.getAttribute('data-index');
      var text = f.searchText[idx];
      var match = terms.every(function (term) { return text.indexOf(term) !== -1; });
      li.hidden = !match;
      if (match) {
        total++;
        sectionCounts[sectionIndex[idx]]++;
      }
    });

    f.tocDetails.forEach(function (d) {
      var si = +d.getAttribute('data-section');
      var n = sectionCounts[si];
      var all = f.report.sections[si].tables.length;
      d.parentNode.hidden = n === 0;
      d.querySelector('.section-count-n').textContent = terms.length
        ? n.toLocaleString() + ' of ' + plural(all, 'table')
        : plural(all, 'table');
      if (terms.length && n > 0) d.open = true;
    });

    var msg = terms.length
      ? plural(total, 'table') + ' match “' + f.view.filter.value.trim() + '”.'
      : plural(f.report.tables.length, 'table') + ' in ' + plural(f.report.sections.length, 'section') + '.';
    f.view.filterCount.textContent = msg;
  }

  /* ------------------------------------------------------------------ */
  /* Table view                                                          */
  /* ------------------------------------------------------------------ */

  function showTable(f, t) {
    f.currentTable = t;
    var v = f.view;
    v.toc.hidden = true;
    v.table.hidden = false;

    v.section.textContent = sectionLabel(t.section);
    v.title.textContent = 'Table ' + t.id + ': ' + t.title;
    v.desc.textContent = t.description && t.description !== t.title ? t.description : '';
    v.desc.hidden = !v.desc.textContent;

    var blocks;
    try {
      blocks = StopsParser.parseTable(t.body);
    } catch (err) {
      blocks = [{ type: 'text', lines: t.body }];
    }
    v.content.innerHTML = renderBlocks(f, t, blocks);
    stackStickyHeaders(v.content);

    v.raw.textContent = t.body.join('\n');
    v.rawWrap.hidden = true;
    v.rawToggle.setAttribute('aria-expanded', 'false');
    v.rawToggle.textContent = 'Show original report text';

    v.prev.disabled = t.index === 0;
    v.next.disabled = t.index === f.report.tables.length - 1;

    window.scrollTo(0, 0);
    v.title.focus();
    updateDocumentTitle();
  }

  function stepTable(f, delta) {
    if (!f.currentTable) return;
    var t = f.report.tables[f.currentTable.index + delta];
    if (!t) return;
    showTable(f, t);
    announce('Showing table ' + t.id + '.');
  }

  function closeTable(f) {
    var v = f.view;
    var last = f.currentTable;
    f.currentTable = null;
    v.table.hidden = true;
    v.toc.hidden = false;
    v.content.innerHTML = '';
    v.raw.textContent = '';
    updateDocumentTitle();

    // Return focus to the entry for the table last shown (which may differ
    // from the one originally selected after Previous/Next).
    var target = null;
    if (last) {
      target = f.panel.querySelector('.toc-item[data-table-id="' + cssEscape(last.id) + '"]');
      if (target) {
        var li = target.parentNode;
        if (li.hidden) target = null;
        else {
          var details = target.closest('details');
          if (details) details.open = true;
        }
      }
    }
    if (!target && f.returnFocus && document.contains(f.returnFocus)) target = f.returnFocus;
    window.scrollTo(0, f.tocScroll || 0);
    // Focus scrolls the entry into view if Previous/Next moved past it.
    (target || v.tocHeading).focus();
    announce('Returned to table of contents.');
  }

  /* Offset each sticky header row by the height of the rows above it. */
  function stackStickyHeaders(container) {
    Array.prototype.forEach.call(container.querySelectorAll('thead'), function (thead) {
      var top = 0;
      Array.prototype.forEach.call(thead.rows, function (tr) {
        Array.prototype.forEach.call(tr.cells, function (cell) { cell.style.top = top + 'px'; });
        top += tr.getBoundingClientRect().height;
      });
    });
  }

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
  }

  function renderBlocks(f, t, blocks) {
    var grids = blocks.filter(function (b) { return b.type === 'grid'; }).length;
    var gridNo = 0;
    var html = '';
    blocks.forEach(function (b) {
      if (b.type === 'text') {
        html += '<pre class="report-text">' + esc(b.lines.join('\n')) + '</pre>';
      } else {
        gridNo++;
        html += renderGrid(f, t, b, gridNo, grids);
      }
    });
    if (!grids) {
      html = '<p class="no-grid-note">This page of the report contains text only.</p>' + html;
    }
    return html;
  }

  function renderGrid(f, t, grid, gridNo, gridCount) {
    var p = 'g' + (++renderCounter);
    var ncols = grid.columns.length;
    var capId = p + '-cap';
    var complex = grid.headerRows.length > 1;

    // Header ids covering each column, bottom row last.
    var colHeaders = [];
    for (var c = 0; c < ncols; c++) colHeaders.push([]);

    var thead = '';
    grid.headerRows.forEach(function (row, ri) {
      thead += '<tr>';
      row.forEach(function (cell) {
        var colspan = cell.span > 1 ? ' colspan="' + cell.span + '"' : '';
        if (!cell.text) {
          thead += '<td' + colspan + '></td>';
          return;
        }
        var id = p + '-h' + ri + '-' + cell.start;
        for (var cc = cell.start; cc < cell.start + cell.span; cc++) colHeaders[cc].push(id);
        var numeric = cell.span === 1 && grid.columns[cell.start] && grid.columns[cell.start].numeric;
        thead += '<th id="' + id + '" scope="' + (cell.span > 1 ? 'colgroup' : 'col') + '"' + colspan +
          (numeric ? ' class="num"' : '') + '>' + esc(cell.text) + '</th>';
      });
      thead += '</tr>';
    });

    // Columns whose header names a table number become links to that table.
    var linkCols = [];
    (grid.headerRows[grid.headerRows.length - 1] || []).forEach(function (cell) {
      if (/table\s*no/i.test(cell.text)) {
        for (var cc = cell.start; cc < cell.start + cell.span; cc++) linkCols[cc] = true;
      }
    });

    var tbody = '';
    var group = null;
    grid.rows.forEach(function (row, rowNo) {
      if (row.group !== group) {
        if (group !== null) tbody += '</tbody>';
        tbody += '<tbody>';
        group = row.group;
      }
      var rowId = p + '-r' + rowNo;
      var hasRowHeader = grid.rowHeaderColumn && row.cells[0];
      tbody += '<tr>';
      row.cells.forEach(function (text, ci) {
        var cls = grid.columns[ci].numeric ? ' class="num"' : '';
        var content = esc(text);
        if (text && linkCols[ci] && f.report.byId[text]) {
          content = '<button type="button" class="link-button" data-table-id="' + esc(text) + '">' + esc(text) +
            '<span class="visually-hidden"> (open table)</span></button>';
        }
        if (ci === 0 && hasRowHeader) {
          tbody += '<th scope="row" id="' + rowId + '"' +
            (complex && colHeaders[0].length ? ' headers="' + colHeaders[0].join(' ') + '"' : '') +
            '>' + content + '</th>';
          return;
        }
        var headers = '';
        if (complex) {
          var ids = colHeaders[ci].slice();
          if (hasRowHeader) ids.push(rowId);
          if (ids.length) headers = ' headers="' + ids.join(' ') + '"';
        }
        tbody += '<td' + cls + headers + '>' + content + '</td>';
      });
      tbody += '</tr>';
    });
    if (group !== null) tbody += '</tbody>';

    var captionHtml;
    if (grid.caption.length) {
      captionHtml = '<caption id="' + capId + '">' + grid.caption.map(esc).join('<br>') +
        (gridCount > 1 ? '<span class="visually-hidden"> (Table ' + esc(t.id) + ', part ' + gridNo + ' of ' + gridCount + ')</span>' : '') +
        '</caption>';
    } else {
      captionHtml = '<caption id="' + capId + '" class="visually-hidden">Table ' + esc(t.id) +
        (gridCount > 1 ? ', part ' + gridNo + ' of ' + gridCount : '') + ': ' + esc(t.title) + '</caption>';
    }

    var summary = plural(grid.rows.length, 'row') + ', ' + plural(ncols, 'column');

    return '<div class="grid-block">' +
      '<div class="table-scroll" role="region" tabindex="0" aria-labelledby="' + capId + '" aria-describedby="' + p + '-size">' +
        '<table class="data-table">' + captionHtml +
          (thead ? '<thead>' + thead + '</thead>' : '') + tbody +
        '</table>' +
      '</div>' +
      '<p class="grid-size" id="' + p + '-size">' + esc(summary) + '</p>' +
      '</div>';
  }
})();

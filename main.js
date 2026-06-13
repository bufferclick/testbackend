// ══════════════════════════════════════════════════════════
// III — Infrequent, Insufficient or Inadequate?
// Made by BufferClick
// main.js — App logic + Embeddable API
// ══════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ── IIIBatcher API Class ──────────────────────────────
  class IIIBatcher {
    constructor(defaults = {}) {
      this._defaults = {
        labelMode: defaults.labelMode || 'numbered',
        splitMode: defaults.splitMode || 'chars',
        maxChars: defaults.maxChars || 50000,
        batchCount: defaults.batchCount || 2,
        skipBinary: defaults.skipBinary !== undefined ? defaults.skipBinary : true,
        includePlaceholders: defaults.includePlaceholders || false,
        excludeExtensions: defaults.excludeExtensions || [],
        sortFiles: defaults.sortFiles !== undefined ? defaults.sortFiles : true,
        binaryThreshold: defaults.binaryThreshold || 0.15,
        sortFn: defaults.sortFn || null,
        filterFn: defaults.filterFn || null,
        labelFormatter: defaults.labelFormatter || null,
      };
      this._listeners = {};
    }

    on(event, fn) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn);
      return this;
    }

    off(event, fn) {
      if (!this._listeners[event]) return;
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
      return this;
    }

    _emit(event, data) {
      if (this._listeners[event]) {
        this._listeners[event].forEach(fn => fn(data));
      }
    }

    destroy() {
      this._listeners = {};
    }

    _getExt(name) {
      const i = name.lastIndexOf('.');
      return i >= 0 ? name.slice(i).toLowerCase() : '';
    }

    _likelyBinary(buffer) {
      const bytes = new Uint8Array(buffer.slice(0, 8192));
      let suspicious = 0;
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i];
        if (b === 0) return true;
        if ((b < 7 || (b > 13 && b < 32)) && b !== 9) suspicious++;
      }
      return bytes.length > 0 && suspicious / bytes.length > this._defaults.binaryThreshold;
    }

    async _readFile(file) {
      const buffer = await file.arrayBuffer();
      if (this._likelyBinary(buffer)) return { ok: false, reason: 'binary', code: 'BINARY_DETECTED' };
      try {
        return { ok: true, text: new TextDecoder('utf-8', { fatal: false }).decode(buffer) };
      } catch {
        return { ok: false, reason: 'unreadable', code: 'READ_FAILED' };
      }
    }

    _buildLabel(index, name, mode) {
      if (this._defaults.labelFormatter) {
        return this._defaults.labelFormatter(index, name);
      }
      if (mode === 'numbered') return `file.${index}:`;
      if (mode === 'filename') return `${name}:`;
      return `file.${index} — ${name}:`;
    }

    _splitByChars(entries, max) {
      const batches = [];
      let cur = '';
      for (const e of entries) {
        const add = cur ? '\n\n' + e : e;
        if (cur && cur.length + add.length > max) { batches.push(cur); cur = e; }
        else cur += add;
      }
      if (cur) batches.push(cur);
      return batches;
    }

    _splitByCount(entries, count) {
      if (count <= 1) return [entries.join('\n\n')];
      const size = Math.ceil(entries.length / count);
      const batches = [];
      for (let i = 0; i < entries.length; i += size)
        batches.push(entries.slice(i, i + size).join('\n\n'));
      return batches;
    }

    async process(fileList, options = {}) {
      const opts = { ...this._defaults, ...options };
      const excludeSet = new Set((opts.excludeExtensions || []).map(e => e.toLowerCase()));
      const files = Array.from(fileList || []);

      if (!files.length) throw new Error('NO_FILES');

      if (opts.sortFn) {
        files.sort(opts.sortFn);
      } else if (opts.sortFiles) {
        files.sort((a, b) => (a.webkitRelativePath || a.name).toLowerCase()
          .localeCompare((b.webkitRelativePath || b.name).toLowerCase()));
      }

      const entries = [];
      const fileListResult = [];
      let included = 0, skipped = 0, idx = 1;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const name = file.webkitRelativePath || file.name;
        const ext = this._getExt(name);

        if (opts.filterFn && !opts.filterFn(file)) {
          fileListResult.push({ name, size: file.size, status: 'filtered' });
          this._emit('fileRead', { name, index: i + 1, total: files.length, status: 'filtered' });
          skipped++;
          if (opts.includePlaceholders) {
            entries.push(`${this._buildLabel(idx, name, opts.labelMode)}\n[Filtered: ${name}]`);
            idx++;
          }
          continue;
        }

        if (excludeSet.has(ext)) {
          fileListResult.push({ name, size: file.size, status: 'excluded' });
          this._emit('fileRead', { name, index: i + 1, total: files.length, status: 'excluded' });
          skipped++;
          if (opts.includePlaceholders) {
            entries.push(`${this._buildLabel(idx, name, opts.labelMode)}\n[Excluded: ${name}]`);
            idx++;
          }
          continue;
        }

        const result = await this._readFile(file);

        if (!result.ok) {
          if (opts.skipBinary) {
            fileListResult.push({ name, size: file.size, status: 'skipped' });
            this._emit('fileRead', { name, index: i + 1, total: files.length, status: 'skipped' });
            this._emit('error', { file: name, error: result.code });
            skipped++;
            if (opts.includePlaceholders) {
              entries.push(`${this._buildLabel(idx, name, opts.labelMode)}\n[Skipped (${result.reason}): ${name}]`);
              idx++;
            }
          } else {
            entries.push(`${this._buildLabel(idx, name, opts.labelMode)}\n[${result.reason}: ${name}]`);
            fileListResult.push({ name, size: file.size, status: 'included' });
            idx++; included++;
          }
          continue;
        }

        entries.push(`${this._buildLabel(idx, name, opts.labelMode)}\n${result.text}`);
        fileListResult.push({ name, size: file.size, status: 'included' });
        this._emit('fileRead', { name, index: i + 1, total: files.length, status: 'included' });
        idx++; included++;

        this._emit('progress', {
          percent: Math.round(((i + 1) / files.length) * 100),
          current: i + 1,
          total: files.length
        });
      }

      let batches;
      if (opts.splitMode === 'none') batches = entries.length ? [entries.join('\n\n')] : [];
      else if (opts.splitMode === 'count') batches = this._splitByCount(entries, Math.max(1, opts.batchCount));
      else batches = this._splitByChars(entries, Math.max(1, opts.maxChars));

      const totalChars = batches.reduce((a, b) => a + b.length, 0);

      const resultObj = {
        batches,
        included,
        skipped,
        totalChars,
        totalFiles: files.length,
        fileList: fileListResult,
        options: opts
      };

      this._emit('complete', resultObj);
      return resultObj;
    }

    async processText(filesArray, options = {}) {
      const opts = { ...this._defaults, ...options };
      const excludeSet = new Set((opts.excludeExtensions || []).map(e => e.toLowerCase()));

      if (!filesArray || !filesArray.length) throw new Error('NO_FILES');

      if (opts.sortFiles) {
        filesArray.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      }

      const entries = [];
      const fileListResult = [];
      let included = 0, skipped = 0, idx = 1;

      for (let i = 0; i < filesArray.length; i++) {
        const { name, content } = filesArray[i];
        const ext = this._getExt(name);

        if (excludeSet.has(ext)) {
          fileListResult.push({ name, size: content.length, status: 'excluded' });
          skipped++;
          if (opts.includePlaceholders) {
            entries.push(`${this._buildLabel(idx, name, opts.labelMode)}\n[Excluded: ${name}]`);
            idx++;
          }
          continue;
        }

        entries.push(`${this._buildLabel(idx, name, opts.labelMode)}\n${content}`);
        fileListResult.push({ name, size: content.length, status: 'included' });
        idx++; included++;

        this._emit('progress', {
          percent: Math.round(((i + 1) / filesArray.length) * 100),
          current: i + 1,
          total: filesArray.length
        });
      }

      let batches;
      if (opts.splitMode === 'none') batches = entries.length ? [entries.join('\n\n')] : [];
      else if (opts.splitMode === 'count') batches = this._splitByCount(entries, Math.max(1, opts.batchCount));
      else batches = this._splitByChars(entries, Math.max(1, opts.maxChars));

      const totalChars = batches.reduce((a, b) => a + b.length, 0);

      const resultObj = { batches, included, skipped, totalChars, totalFiles: filesArray.length, fileList: fileListResult, options: opts };
      this._emit('complete', resultObj);
      return resultObj;
    }
  }

  // Expose globally and as module
  if (typeof window !== 'undefined') window.IIIBatcher = IIIBatcher;
  if (typeof module !== 'undefined' && module.exports) module.exports = { IIIBatcher };

  // ── PostMessage API ─────────────────────────────────
  if (typeof window !== 'undefined') {
    const _pmBatcher = new IIIBatcher();

    _pmBatcher.on('progress', (data) => {
      if (window.parent !== window) {
        window.parent.postMessage({ type: 'III_PROGRESS', ...data }, '*');
      }
    });

    window.addEventListener('message', async (e) => {
      if (!e.data || !e.data.type) return;

      if (e.data.type === 'III_CONFIG') {
        Object.assign(_pmBatcher._defaults, e.data.options || {});
      }

      if (e.data.type === 'III_PROCESS') {
        try {
          const result = await _pmBatcher.processText(e.data.files || []);
          window.parent.postMessage({ type: 'III_RESULT', result }, '*');
        } catch (err) {
          window.parent.postMessage({ type: 'III_ERROR', error: err.message }, '*');
        }
      }
    });
  }

  // ══════════════════════════════════════════════════════
  // APP LOGIC — Only runs on the III website itself
  // ══════════════════════════════════════════════════════

  if (typeof document === 'undefined') return;

  // ── Router ──────────────────────────────────────────
  function route() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    if (path === '/api') {
      document.getElementById('page-api').classList.add('active');
      document.title = 'III API — Infrequent, Insufficient or Inadequate?';
    } else if (path === '/forums/api') {
      document.getElementById('page-docs').classList.add('active');
      document.title = 'III API Documentation — Infrequent, Insufficient or Inadequate?';
    } else {
      document.getElementById('page-app').classList.add('active');
      document.title = 'III — Infrequent, Insufficient or Inadequate?';
    }
  }

  // Handle link clicks for SPA navigation
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('#') || a.target === '_blank') return;
    e.preventDefault();
    window.history.pushState({}, '', href);
    route();
  });

  window.addEventListener('popstate', route);

  // ── Helpers ─────────────────────────────────────────
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function formatBytes(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
  function getExt(n) { const i = n.lastIndexOf('.'); return i >= 0 ? n.slice(i).toLowerCase() : ''; }
  function getKey(f) { return f.webkitRelativePath || f.name; }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  const toastEl = document.getElementById('toast');
  function showToast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  function downloadTxt(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Code copy for docs ──────────────────────────────
  window.copyCode = async function (btn) {
    const block = btn.closest('.docs-code-block');
    const pre = block.querySelector('pre');
    const ok = await copyText(pre.textContent);
    if (ok) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
    else showToast('Clipboard unavailable');
  };

  // ── Syntax highlighting ─────────────────────────────
  function highlightBatch(raw) {
    const lines = raw.split('\n');
    const hl = [];
    const re = /^(file\.\d+(?:\s*—\s*.+)?:|.+\.\w+:)$/;
    for (const line of lines) {
      if (re.test(line.trim())) hl.push(`<span class="line-file-label">${esc(line)}</span>`);
      else if (line.trim() === '') hl.push('');
      else if (line.trim().startsWith('[Skipped') || line.trim().startsWith('[Excluded') || line.trim().startsWith('[Filtered')) hl.push(`<span class="syn-skipped">${esc(line)}</span>`);
      else hl.push(highlightLine(line));
    }
    return hl.join('\n');
  }

  function highlightLine(line) {
    let o = esc(line);
    o = o.replace(/(\/\/.*)$/gm, '<span class="syn-comment">$1</span>');
    o = o.replace(/(#.*)$/gm, '<span class="syn-comment">$1</span>');
    o = o.replace(/("(?:[^"\\]|\\.)*?")/g, '<span class="syn-string">$1</span>');
    o = o.replace(/('(?:[^'\\]|\\.)*?')/g, '<span class="syn-string">$1</span>');
    o = o.replace(/(`(?:[^`\\]|\\.)*?`)/g, '<span class="syn-string">$1</span>');
    o = o.replace(/\b(\d+\.?\d*)\b/g, '<span class="syn-number">$1</span>');
    const kw = ['function', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'import', 'export', 'from', 'default', 'new', 'this', 'super', 'try', 'catch', 'finally', 'throw', 'async', 'await', 'yield', 'of', 'in', 'typeof', 'instanceof', 'void', 'delete', 'true', 'false', 'null', 'undefined', 'def', 'print', 'self', 'elif', 'except', 'lambda', 'with', 'as', 'pass', 'raise', 'None', 'True', 'False', 'and', 'or', 'not', 'is'];
    for (const k of kw) o = o.replace(new RegExp(`\\b(${k})\\b`, 'g'), '<span class="syn-keyword">$1</span>');
    o = o.replace(/(&lt;\/?)([\w-]+)/g, '<span class="syn-tag">$1$2</span>');
    o = o.replace(/\b([a-zA-Z_]\w*)\s*\(/g, '<span class="syn-func">$1</span>(');
    o = o.replace(/(===|!==|==|!=|&lt;=|&gt;=|=&gt;|\+\+|--|\|\||&amp;&amp;)/g, '<span class="syn-operator">$1</span>');
    o = o.replace(/([{}()\[\]])/g, '<span class="syn-bracket">$1</span>');
    return o;
  }

  // ── App State ───────────────────────────────────────
  const PRESETS = {
    images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.tiff', '.tif'],
    videos: ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm'],
    audio: ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a'],
    archives: ['.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.zst'],
    binaries: ['.exe', '.bin', '.dll', '.so', '.dylib', '.apk', '.deb', '.rpm', '.msi', '.dmg', '.iso'],
    docs: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.odt', '.ods'],
    fonts: ['.ttf', '.otf', '.woff', '.woff2', '.eot'],
  };

  let allFiles = [];
  let lastBatches = [];
  const excludedExts = new Set();
  const activePresets = new Set();

  // ── Wait for DOM ────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    route();
    initApp();
    initDocs();
  });

  function initApp() {
    const $ = id => document.getElementById(id);
    const folderInput = $('folderInput');
    const filesInput = $('filesInput');
    const fileListSection = $('fileListSection');
    const fileListInner = $('fileListInner');
    const fileCountLabel = $('fileCountLabel');
    const clearFilesBtn = $('clearFilesBtn');
    const searchInput = $('searchInput');
    const labelModeEl = $('labelMode');
    const splitModeEl = $('splitMode');
    const splitValueEl = $('splitValue');
    const splitValueRow = $('splitValueRow');
    const splitValueLabel = $('splitValueLabel');
    const splitHintEl = $('splitHint');
    const extInput = $('extInput');
    const extAddBtn = $('extAddBtn');
    const tagListEl = $('tagList');
    const skipBinaryEl = $('skipBinary');
    const showPreviewEl = $('showPreview');
    const includePlaceholderEl = $('includePlaceholder');
    const buildBtn = $('buildBtn');
    const outputSection = $('outputSection');
    const copyAllBtn = $('copyAllBtn');
    const downloadAllBtn = $('downloadAllBtn');
    const batchListEl = $('batchList');

    if (!folderInput) return; // Not on app page

    folderInput.addEventListener('change', () => mergeFiles(folderInput.files));
    filesInput.addEventListener('change', () => mergeFiles(filesInput.files));

    function mergeFiles(nf) {
      const ex = new Set(allFiles.map(f => getKey(f)));
      for (const f of Array.from(nf)) { const k = getKey(f); if (!ex.has(k)) { allFiles.push(f); ex.add(k); } }
      allFiles.sort((a, b) => getKey(a).toLowerCase().localeCompare(getKey(b).toLowerCase()));
      renderFileList();
    }

    clearFilesBtn.addEventListener('click', () => { allFiles = []; folderInput.value = ''; filesInput.value = ''; renderFileList(); });
    searchInput.addEventListener('input', () => renderFileList());

    function renderFileList() {
      if (!allFiles.length) { fileListSection.style.display = 'none'; return; }
      fileListSection.style.display = 'block';
      fileListInner.innerHTML = '';
      const q = searchInput.value.toLowerCase().trim();
      let shown = 0;
      for (const file of allFiles) {
        const name = getKey(file);
        if (q && !name.toLowerCase().includes(q)) continue;
        const ext = getExt(name);
        const skip = excludedExts.has(ext);
        shown++;
        const d = document.createElement('div'); d.className = 'file-item';
        d.innerHTML = `<span class="icon icon-sm" style="opacity:0.4"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><polyline points="14 2 14 8 20 8"/></svg></span><span class="fname">${esc(name)}</span><span class="fsize">${formatBytes(file.size)}</span><span class="fstatus ${skip ? 'skip' : 'ok'}">${skip ? 'excluded' : 'ok'}</span>`;
        fileListInner.appendChild(d);
      }
      fileCountLabel.textContent = `${allFiles.length} file${allFiles.length !== 1 ? 's' : ''}${q ? ` (${shown} shown)` : ''}`;
    }

    splitModeEl.addEventListener('change', () => {
      const m = splitModeEl.value;
      if (m === 'none') splitValueRow.classList.add('hidden');
      else {
        splitValueRow.classList.remove('hidden');
        if (m === 'chars') { splitValueLabel.textContent = 'Max characters per batch'; splitValueEl.value = '50000'; splitHintEl.textContent = 'Files grouped until character limit is reached.'; }
        else { splitValueLabel.textContent = 'Number of batches'; splitValueEl.value = '2'; splitHintEl.textContent = 'Files evenly split across the given number.'; }
      }
    });

    function addExts(raw) {
      let c = false;
      raw.split(',').forEach(s => { let e = s.trim().toLowerCase(); if (!e) return; if (!e.startsWith('.')) e = '.' + e; if (!excludedExts.has(e)) { excludedExts.add(e); c = true; } });
      if (c) { renderTags(); renderFileList(); }
    }

    function removeExt(ext) { excludedExts.delete(ext); renderTags(); renderFileList(); syncPresetStates(); }

    function renderTags() {
      tagListEl.innerHTML = '';
      const sorted = [...excludedExts].sort();
      if (!sorted.length) { tagListEl.innerHTML = '<div class="empty-state">No exclusions — all file types included.</div>'; return; }
      for (const ext of sorted) {
        const s = document.createElement('span'); s.className = 'tag';
        s.innerHTML = `${esc(ext)} <span class="remove">×</span>`;
        s.querySelector('.remove').addEventListener('click', () => removeExt(ext));
        tagListEl.appendChild(s);
      }
    }

    extAddBtn.addEventListener('click', () => { addExts(extInput.value); extInput.value = ''; });
    extInput.addEventListener('keydown', e => { if (e.key === 'Enter') { addExts(extInput.value); extInput.value = ''; } });

    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.preset;
        if (key === 'clear') { excludedExts.clear(); activePresets.clear(); document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active')); renderTags(); renderFileList(); return; }
        const exts = PRESETS[key]; if (!exts) return;
        if (activePresets.has(key)) { activePresets.delete(key); btn.classList.remove('active'); exts.forEach(e => excludedExts.delete(e)); }
        else { activePresets.add(key); btn.classList.add('active'); exts.forEach(e => excludedExts.add(e)); }
        renderTags(); renderFileList();
      });
    });

    function syncPresetStates() {
      for (const [key, exts] of Object.entries(PRESETS)) {
        const btn = document.querySelector(`[data-preset="${key}"]`); if (!btn) continue;
        const all = exts.every(e => excludedExts.has(e));
        if (all) { activePresets.add(key); btn.classList.add('active'); } else { activePresets.delete(key); btn.classList.remove('active'); }
      }
    }

    renderTags();

    // Build
    const appBatcher = new IIIBatcher();

    buildBtn.addEventListener('click', async () => {
      if (!allFiles.length) { showToast('Select files first'); return; }
      buildBtn.innerHTML = '<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg></span> Processing...';
      buildBtn.disabled = true;
      await new Promise(r => setTimeout(r, 50));

      const result = await appBatcher.process(allFiles, {
        labelMode: labelModeEl.value,
        splitMode: splitModeEl.value,
        maxChars: parseInt(splitValueEl.value || '50000', 10),
        batchCount: parseInt(splitValueEl.value || '2', 10),
        skipBinary: skipBinaryEl.checked,
        includePlaceholders: includePlaceholderEl.checked,
        excludeExtensions: [...excludedExts],
      });

      lastBatches = result.batches;
      const showPreview = showPreviewEl.checked;

      $('statFiles').textContent = result.included;
      $('statSkipped').textContent = result.skipped;
      $('statBatches').textContent = result.batches.length;

      outputSection.classList.remove('hidden');
      batchListEl.innerHTML = '';

      result.batches.forEach((batch, i) => {
        const lines = batch.split('\n').length;
        const card = document.createElement('div'); card.className = 'batch-card';
        let preview = '';
        if (showPreview) preview = `<div class="code-view"><pre>${highlightBatch(batch)}</pre><textarea class="hidden-textarea">${esc(batch)}</textarea></div>`;

        card.innerHTML = `
          <div class="batch-top"><div><div class="batch-title">Batch ${i + 1}</div><div class="batch-meta">${batch.length.toLocaleString()} chars · ${lines.toLocaleString()} lines</div></div><span class="batch-number">${i + 1} / ${result.batches.length}</span></div>
          ${preview}
          <div class="btn-row">
            <button class="btn btn-primary btn-sm copy-btn"><span class="icon icon-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg></span>Copy</button>
            <button class="btn btn-outline btn-sm dl-btn"><span class="icon icon-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg></span>Download</button>
          </div>`;

        if (showPreview) card.querySelector('.hidden-textarea').value = batch;

        card.querySelector('.copy-btn').addEventListener('click', async () => {
          const ok = await copyText(batch);
          if (ok) showToast(`Batch ${i + 1} copied`);
          else {
            if (showPreview) { const ta = card.querySelector('.hidden-textarea'); ta.style.cssText = 'position:static;width:100%;height:200px;opacity:1;margin-top:10px;background:#050507;color:#fafafa;border:1px solid #27272a;border-radius:8px;padding:12px;font-family:monospace;font-size:12px;'; ta.focus(); ta.select(); showToast('Selected — copy manually'); }
            else showToast('Clipboard unavailable');
          }
        });

        card.querySelector('.dl-btn').addEventListener('click', () => downloadTxt(batch, `batch_${i + 1}.txt`));
        batchListEl.appendChild(card);
      });

      buildBtn.innerHTML = '<span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></span> Build Batches';
      buildBtn.disabled = false;
      outputSection.scrollIntoView({ behavior: 'smooth' });
    });

    copyAllBtn.addEventListener('click', async () => {
      if (!lastBatches.length) return;
      const ok = await copyText(lastBatches.join('\n\n'));
      if (ok) showToast('All batches copied'); else showToast('Clipboard unavailable');
    });

    downloadAllBtn.addEventListener('click', () => {
      if (!lastBatches.length) return;
      if (lastBatches.length === 1) downloadTxt(lastBatches[0], 'all_batches.txt');
      else lastBatches.forEach((b, i) => downloadTxt(b, `batch_${i + 1}.txt`));
    });
  }

  // ── Docs page logic ─────────────────────────────────
  function initDocs() {
    const copyDocsBtn = document.getElementById('copyDocsBtn');
    if (!copyDocsBtn) return;

    copyDocsBtn.addEventListener('click', async () => {
      const docsContent = document.getElementById('docsContent');
      if (!docsContent) return;
      const text = docsContent.innerText;
      const ok = await copyText(text);
      if (ok) showToast('Documentation copied!');
      else showToast('Clipboard unavailable');
    });

    // Smooth scroll for doc nav
    document.querySelectorAll('.docs-nav a').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href.startsWith('#')) return;
        e.preventDefault();
        e.stopPropagation();
        const target = document.querySelector(href);
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          document.querySelectorAll('.docs-nav a').forEach(l => l.classList.remove('active'));
          link.classList.add('active');
        }
      });
    });

    // Update active nav on scroll
    const sections = document.querySelectorAll('.docs-section');
    const navLinks = document.querySelectorAll('.docs-nav a');

    if (sections.length && navLinks.length) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            navLinks.forEach(l => l.classList.remove('active'));
            const activeLink = document.querySelector(`.docs-nav a[href="#${entry.target.id}"]`);
            if (activeLink) activeLink.classList.add('active');
          }
        });
      }, { rootMargin: '-20% 0px -70% 0px' });

      sections.forEach(s => observer.observe(s));
    }
  }

})();

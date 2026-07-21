/**
 * datepicker.js — DatePicker reutilizável SSO
 * Suporta: data única, intervalo, atalhos, formato BR.
 * Sem dependências externas.
 */
class SSODatePicker {
  constructor({ triggerEl, onApply, onClear, placeholder = 'Data específica' }) {
    this._trigger = triggerEl;
    this._onApply = onApply;
    this._onClear = onClear;
    this._placeholder = placeholder;
    this._start = null;  // 'YYYY-MM-DD'
    this._end   = null;
    this._hover = null;
    this._mode  = 'range'; // 'single' | 'range'
    this._navDate = this._today();  // month being displayed
    this._open  = false;
    this._panel = null;
    this._build();
  }

  // ── Dates ─────────────────────────────────────────────────────────────
  _today() {
    return new Date().toISOString().slice(0, 10);
  }
  _addDays(d, n) {
    const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10);
  }
  _startOfMonth(d) { return d.slice(0, 7) + '-01'; }
  _endOfMonth(d) {
    const dt = new Date(d.slice(0, 7) + '-01');
    dt.setMonth(dt.getMonth() + 1); dt.setDate(0);
    return dt.toISOString().slice(0, 10);
  }
  _prevMonth(d) {
    const dt = new Date(d.slice(0, 7) + '-01'); dt.setMonth(dt.getMonth() - 1);
    return dt.toISOString().slice(0, 10);
  }
  _nextMonth(d) {
    const dt = new Date(d.slice(0, 7) + '-01'); dt.setMonth(dt.getMonth() + 1);
    return dt.toISOString().slice(0, 10);
  }
  _fmtBR(d) {
    if (!d) return '';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }
  _monthLabel(d) {
    const dt = new Date(d.slice(0, 7) + '-01');
    return dt.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  // ── Build ─────────────────────────────────────────────────────────────
  _build() {
    // Trigger button label
    this._trigger.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
    document.addEventListener('click', e => { if (this._open && !this._panel?.contains(e.target)) this._close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && this._open) this._close(); });
    this._trigger.textContent = this._placeholder;
  }

  _toggle() { this._open ? this._close() : this._openPanel(); }

  _openPanel() {
    this._close();
    this._navDate = this._start || this._today();
    this._panel = document.createElement('div');
    this._panel.className = 'dp-panel';
    this._panel.addEventListener('click', e => e.stopPropagation());
    this._render();
    document.body.appendChild(this._panel);
    this._position();
    this._open = true;
    this._trigger.classList.add('dp-active');
  }

  _close() {
    if (this._panel) { this._panel.remove(); this._panel = null; }
    this._open = false;
    this._hover = null;
    this._trigger.classList.remove('dp-active');
  }

  _position() {
    const rect = this._trigger.getBoundingClientRect();
    const p = this._panel;
    p.style.position = 'fixed';
    p.style.zIndex = '9999';
    const pw = 580;
    let left = rect.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    p.style.left = Math.max(8, left) + 'px';
    const below = rect.bottom + 8;
    if (below + 340 > window.innerHeight) {
      p.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
      p.style.top = 'auto';
    } else {
      p.style.top = below + 'px';
      p.style.bottom = 'auto';
    }
  }

  _render() {
    if (!this._panel) return;
    this._panel.innerHTML = this._html();
    this._wire();
  }

  _html() {
    const cal = this._calendarHtml(this._navDate);
    const label = this._start
      ? (this._end && this._end !== this._start
          ? `${this._fmtBR(this._start)} até ${this._fmtBR(this._end)}`
          : this._fmtBR(this._start))
      : '';
    return `
    <div class="dp-inner">
      <div class="dp-shortcuts">
        <button class="dp-shortcut" data-s="today">Hoje</button>
        <button class="dp-shortcut" data-s="yesterday">Ontem</button>
        <button class="dp-shortcut" data-s="7d">Últimos 7 dias</button>
        <button class="dp-shortcut" data-s="30d">Últimos 30 dias</button>
        <button class="dp-shortcut" data-s="thismonth">Este mês</button>
        <button class="dp-shortcut" data-s="lastmonth">Mês anterior</button>
        <button class="dp-shortcut" data-s="all">Todos os dados</button>
      </div>
      <div class="dp-cal-area">
        <div class="dp-cal-nav">
          <button class="dp-nav-btn" id="dp-prev">&#8249;</button>
          <span class="dp-month-label">${this._monthLabel(this._navDate)}</span>
          <button class="dp-nav-btn" id="dp-next">&#8250;</button>
        </div>
        <div class="dp-cal">${cal}</div>
        <div class="dp-mode-row">
          <button class="dp-mode-btn ${this._mode==='single'?'active':''}" data-mode="single">Data única</button>
          <button class="dp-mode-btn ${this._mode==='range'?'active':''}" data-mode="range">Período</button>
        </div>
        ${label ? `<div class="dp-selection-label">${label}</div>` : ''}
      </div>
    </div>
    <div class="dp-footer">
      <button class="dp-btn-clear" id="dp-btn-clear">Limpar seleção</button>
      <button class="dp-btn-apply" id="dp-btn-apply" ${this._start?'':'disabled'}>Aplicar</button>
    </div>`;
  }

  _calendarHtml(monthStr) {
    const first = new Date(monthStr.slice(0,7) + '-01');
    const dowFirst = (first.getDay() + 6) % 7; // Mon=0
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const today = this._today();

    let html = '<div class="dp-weekdays">';
    for (const d of ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']) html += `<span>${d}</span>`;
    html += '</div><div class="dp-days">';

    for (let i = 0; i < dowFirst; i++) html += '<span class="dp-day dp-empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${monthStr.slice(0,7)}-${String(d).padStart(2,'0')}`;
      let cls = 'dp-day';
      if (iso === today) cls += ' dp-today';
      if (this._start && iso === this._start) cls += ' dp-sel-start';
      if (this._end   && iso === this._end  ) cls += ' dp-sel-end';
      if (this._start && this._end && iso > this._start && iso < this._end) cls += ' dp-in-range';
      if (this._hover && this._start && !this._end && iso > this._start && iso <= this._hover) cls += ' dp-hover-range';
      html += `<span class="${cls}" data-d="${iso}">${d}</span>`;
    }
    html += '</div>';
    return html;
  }

  _wire() {
    const p = this._panel;
    p.querySelector('#dp-prev')?.addEventListener('click', () => { this._navDate = this._prevMonth(this._navDate); this._render(); });
    p.querySelector('#dp-next')?.addEventListener('click', () => { this._navDate = this._nextMonth(this._navDate); this._render(); });

    p.querySelectorAll('.dp-mode-btn').forEach(b => b.addEventListener('click', () => {
      this._mode = b.dataset.mode; this._end = this._mode === 'single' ? this._start : this._end; this._render();
    }));

    p.querySelectorAll('.dp-day[data-d]').forEach(el => {
      el.addEventListener('click', () => this._clickDay(el.dataset.d));
      el.addEventListener('mouseenter', () => { if (this._start && !this._end) { this._hover = el.dataset.d; this._render(); } });
    });
    p.querySelector('.dp-cal')?.addEventListener('mouseleave', () => { this._hover = null; this._render(); });

    p.querySelectorAll('.dp-shortcut').forEach(b => b.addEventListener('click', () => this._applyShortcut(b.dataset.s)));

    p.querySelector('#dp-btn-apply')?.addEventListener('click', () => this._apply());
    p.querySelector('#dp-btn-clear')?.addEventListener('click', () => this._clearSel());
  }

  _clickDay(iso) {
    if (this._mode === 'single') {
      this._start = iso; this._end = iso;
    } else if (!this._start || (this._start && this._end)) {
      this._start = iso; this._end = null;
    } else {
      if (iso < this._start) { this._end = this._start; this._start = iso; }
      else { this._end = iso; }
    }
    this._render();
  }

  _applyShortcut(s) {
    const t = this._today();
    const shortcuts = {
      today:     [t, t],
      yesterday: [this._addDays(t, -1), this._addDays(t, -1)],
      '7d':      [this._addDays(t, -6), t],
      '30d':     [this._addDays(t, -29), t],
      thismonth: [this._startOfMonth(t), this._endOfMonth(t)],
      lastmonth: (() => {
        const prev = this._prevMonth(t);
        return [this._startOfMonth(prev), this._endOfMonth(prev)];
      })(),
      all:       [null, null],
    };
    const v = shortcuts[s];
    if (!v) return;
    if (s === 'all') { this._start = null; this._end = null; this._mode = 'range'; this._apply(); return; }
    [this._start, this._end] = v;
    this._mode = (this._start === this._end) ? 'single' : 'range';
    this._apply();
  }

  _apply() {
    const s = this._start, e = this._end || this._start;
    this._close();
    // Update trigger label
    if (s) {
      this._trigger.textContent = (s === e) ? this._fmtBR(s) : `${this._fmtBR(s)} – ${this._fmtBR(e)}`;
      this._trigger.classList.add('dp-has-value');
    } else {
      this._trigger.textContent = this._placeholder;
      this._trigger.classList.remove('dp-has-value');
    }
    this._onApply?.(s, e || s);
  }

  _clearSel() { this._start = null; this._end = null; this._render(); }

  // ── Public API ────────────────────────────────────────────────────────
  clear() {
    this._start = null; this._end = null;
    this._trigger.textContent = this._placeholder;
    this._trigger.classList.remove('dp-has-value');
  }

  getValue() {
    return this._start ? { start: this._start, end: this._end || this._start } : null;
  }
}

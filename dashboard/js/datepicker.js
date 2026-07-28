/**
 * datepicker.js — DatePicker reutilizável SSO
 * Suporta: data única, intervalo, atalhos, formato BR.
 * Sem dependências externas.
 *
 * Limites fixos: 2026-01-01 a 2026-12-31
 * Todas as datas são tratadas em horário LOCAL (sem UTC shift).
 * _parseLocal evita deslocamento de um dia em fusos UTC negativo (ex: UTC-3).
 */
class SSODatePicker {
  // ── Limites de navegação ─────────────────────────────────────────────
  static MIN = '2026-01-01';
  static MAX = '2026-12-31';

  constructor({ triggerEl, onApply, onClear, placeholder = 'Data específica' }) {
    this._trigger = triggerEl;
    this._onApply = onApply;
    this._onClear = onClear;
    this._placeholder = placeholder;
    this._start = null;  // 'YYYY-MM-DD'
    this._end   = null;
    this._hover = null;
    this._mode  = 'range'; // 'single' | 'range'
    this._navDate = this._clampNav(this._today());
    this._open  = false;
    this._panel = null;
    this._build();
  }

  // ── Utilitários de data LOCAL (sem UTC shift) ──────────────────────
  /** Formata Date como YYYY-MM-DD usando campos locais (sem toISOString). */
  _isoLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Data de hoje no horário local do dispositivo. */
  _today() {
    return this._isoLocal(new Date());
  }

  /**
   * Converte 'YYYY-MM-DD' em Date local, sem UTC shift.
   * new Date('2026-07-15') = meia-noite UTC → em UTC-3 = 14/07.
   * new Date(2026, 6, 15)  = meia-noite local → correto.
   */
  _parseLocal(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  _addDays(str, n) {
    const dt = this._parseLocal(str);
    dt.setDate(dt.getDate() + n);
    return this._isoLocal(dt);
  }

  _startOfMonth(str) {
    return str.slice(0, 7) + '-01';
  }

  _endOfMonth(str) {
    const [y, m] = str.split('-').map(Number);
    return this._isoLocal(new Date(y, m, 0));   // dia 0 do mês seguinte = último do atual
  }

  _prevMonth(str) {
    const [y, m] = str.split('-').map(Number);
    return this._isoLocal(new Date(y, m - 2, 1));   // m-1 é 0-indexed atual, m-2 é anterior
  }

  _nextMonth(str) {
    const [y, m] = str.split('-').map(Number);
    return this._isoLocal(new Date(y, m, 1));        // m é 0-indexed do próximo mês
  }

  _monthLabel(str) {
    const [y, m] = str.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }

  _fmtBR(str) {
    if (!str) return '';
    const [y, m, d] = str.split('-');
    return `${d}/${m}/${y}`;
  }

  /** Garante que navDate fique dentro de 2026-01 a 2026-12. */
  _clampNav(str) {
    const s = str || SSODatePicker.MIN;
    const month = s.slice(0, 7);
    if (month < SSODatePicker.MIN.slice(0, 7)) return SSODatePicker.MIN;
    if (month > SSODatePicker.MAX.slice(0, 7)) return SSODatePicker.MAX;
    return s;
  }

  /** Clamp de data ao intervalo 2026. */
  _clampDate(str) {
    if (!str) return str;
    if (str < SSODatePicker.MIN) return SSODatePicker.MIN;
    if (str > SSODatePicker.MAX) return SSODatePicker.MAX;
    return str;
  }

  _canPrev() { return this._navDate.slice(0, 7) > SSODatePicker.MIN.slice(0, 7); }
  _canNext() { return this._navDate.slice(0, 7) < SSODatePicker.MAX.slice(0, 7); }

  // ── Build ─────────────────────────────────────────────────────────────
  _build() {
    this._trigger.addEventListener('click', e => { e.stopPropagation(); this._toggle(); });
    document.addEventListener('click', e => {
      if (this._open && !this._panel?.contains(e.target)) this._close();
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._open) this._close();
    });
    this._trigger.textContent = this._placeholder;
  }

  _toggle() { this._open ? this._close() : this._openPanel(); }

  _openPanel() {
    this._close();
    this._navDate = this._clampNav(this._start || this._today());
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
    const cal   = this._calendarHtml(this._navDate);
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
          <button class="dp-nav-btn" id="dp-prev" ${this._canPrev() ? '' : 'disabled'}>&#8249;</button>
          <span class="dp-month-label">${this._monthLabel(this._navDate)}</span>
          <button class="dp-nav-btn" id="dp-next" ${this._canNext() ? '' : 'disabled'}>&#8250;</button>
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
      <button class="dp-btn-apply" id="dp-btn-apply" ${this._start ? '' : 'disabled'}>Aplicar</button>
    </div>`;
  }

  _calendarHtml(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const first      = new Date(y, m - 1, 1);
    const dowFirst   = (first.getDay() + 6) % 7;       // Seg=0 … Dom=6
    const daysInMonth = new Date(y, m, 0).getDate();
    const today      = this._today();
    const mm         = String(m).padStart(2, '0');

    let html = '<div class="dp-weekdays">';
    for (const d of ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom']) html += `<span>${d}</span>`;
    html += '</div><div class="dp-days">';

    for (let i = 0; i < dowFirst; i++) html += '<span class="dp-day dp-empty"></span>';
    for (let d = 1; d <= daysInMonth; d++) {
      const dd  = String(d).padStart(2, '0');
      const iso = `${y}-${mm}-${dd}`;
      let cls   = 'dp-day';
      if (iso === today)                                                     cls += ' dp-today';
      if (this._start && iso === this._start)                                cls += ' dp-sel-start';
      if (this._end   && iso === this._end)                                  cls += ' dp-sel-end';
      if (this._start && this._end && iso > this._start && iso < this._end) cls += ' dp-in-range';
      if (this._hover && this._start && !this._end
          && iso > this._start && iso <= this._hover)                        cls += ' dp-hover-range';
      html += `<span class="${cls}" data-d="${iso}">${d}</span>`;
    }
    html += '</div>';
    return html;
  }

  _wire() {
    const p = this._panel;

    p.querySelector('#dp-prev')?.addEventListener('click', () => {
      if (this._canPrev()) { this._navDate = this._prevMonth(this._navDate); this._render(); }
    });
    p.querySelector('#dp-next')?.addEventListener('click', () => {
      if (this._canNext()) { this._navDate = this._nextMonth(this._navDate); this._render(); }
    });

    p.querySelectorAll('.dp-mode-btn').forEach(b => b.addEventListener('click', () => {
      this._mode = b.dataset.mode;
      if (this._mode === 'single' && this._start) this._end = this._start;
      this._render();
    }));

    p.querySelectorAll('.dp-day[data-d]').forEach(el => {
      el.addEventListener('click',      () => this._clickDay(el.dataset.d));
      el.addEventListener('mouseenter', () => {
        if (this._start && !this._end) { this._hover = el.dataset.d; this._render(); }
      });
    });
    p.querySelector('.dp-cal')?.addEventListener('mouseleave', () => {
      this._hover = null; this._render();
    });

    p.querySelectorAll('.dp-shortcut').forEach(b =>
      b.addEventListener('click', () => this._applyShortcut(b.dataset.s)));
    p.querySelector('#dp-btn-apply')?.addEventListener('click', () => this._apply());
    p.querySelector('#dp-btn-clear')?.addEventListener('click', () => this._clearSel());
  }

  _clickDay(iso) {
    if (this._mode === 'single') {
      this._start = iso;
      this._end   = iso;
    } else {
      if (!this._start || (this._start && this._end)) {
        this._start = iso; this._end = null;
      } else {
        if (iso < this._start) { this._end = this._start; this._start = iso; }
        else                   { this._end = iso; }
      }
    }
    this._render();
  }

  _applyShortcut(s) {
    const t = this._today();

    if (s === 'all') {
      this._start = null; this._end = null; this._mode = 'range';
      this._apply(); return;
    }

    let start, end;
    switch (s) {
      case 'today':     start = t;                         end = t;     break;
      case 'yesterday': start = this._addDays(t, -1);     end = start; break;
      case '7d':        start = this._addDays(t, -6);     end = t;     break;
      case '30d':       start = this._addDays(t, -29);    end = t;     break;
      case 'thismonth': start = this._startOfMonth(t);    end = this._endOfMonth(t);  break;
      case 'lastmonth': {
        const prev = this._prevMonth(t);
        start = this._startOfMonth(prev); end = this._endOfMonth(prev); break;
      }
      default: return;
    }

    // Clamp ao intervalo 2026 — permitir atalhos mesmo que hoje seja 2027
    start = this._clampDate(start);
    end   = this._clampDate(end);
    if (!start) { this._start = null; this._end = null; this._apply(); return; }

    this._start   = start;
    this._end     = end;
    this._mode    = (start === end) ? 'single' : 'range';
    this._navDate = this._clampNav(start);
    this._apply();
  }

  _apply() {
    const s = this._start;
    const e = this._end || this._start;
    this._close();
    if (s) {
      this._trigger.textContent = (s === e)
        ? this._fmtBR(s)
        : `${this._fmtBR(s)} – ${this._fmtBR(e)}`;
      this._trigger.classList.add('dp-has-value');
    } else {
      this._trigger.textContent = this._placeholder;
      this._trigger.classList.remove('dp-has-value');
    }
    this._onApply?.(s, e || s);
  }

  _clearSel() {
    this._start = null; this._end = null; this._hover = null;
    this._render();
  }

  // ── Public API ────────────────────────────────────────────────────────
  clear() {
    this._start = null; this._end = null;
    this._trigger.textContent = this._placeholder;
    this._trigger.classList.remove('dp-has-value', 'dp-active');
  }

  getValue() {
    return this._start ? { start: this._start, end: this._end || this._start } : null;
  }
}

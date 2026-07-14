import { Directive, ElementRef, HostListener, Input, OnDestroy, inject } from '@angular/core';
import { Member } from '../../core/models/models';
import { normalizeForMention } from '../../core/util/mentions';

/**
 * Autocompletado de menciones para <textarea>, <input> y [contenteditable].
 * Al escribir '@' (al inicio o tras un espacio) muestra un dropdown con los
 * miembros; seleccionar (click / Enter / Tab) inserta '@Nombre '. La detección
 * de menciones al guardar vive aparte en core/util/mentions.ts — esta
 * directiva solo ayuda a escribirlas.
 *
 * El dropdown se crea imperativamente y se cuelga de <body> para escapar de
 * cualquier overflow del modal; se ancla bajo el campo, no bajo el caret.
 */
@Directive({ selector: '[appMentions]', standalone: true })
export class MentionsDirective implements OnDestroy {
  @Input('appMentions') members: readonly Member[] | null = [];

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private box: HTMLDivElement | null = null;
  private options: Member[] = [];
  private active = 0;
  private readonly onDocScroll = () => this.close();

  ngOnDestroy() {
    this.close();
  }

  @HostListener('input')
  @HostListener('keyup', ['$event'])
  onInput(ev?: KeyboardEvent) {
    // Las flechas/Enter navegan el dropdown (keydown); no re-evaluar la query.
    if (ev && ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(ev.key)) return;
    this.refresh();
  }

  @HostListener('keydown', ['$event'])
  onKeydown(ev: KeyboardEvent) {
    if (!this.box) return;
    switch (ev.key) {
      case 'ArrowDown':
        ev.preventDefault();
        this.setActive(this.active + 1);
        break;
      case 'ArrowUp':
        ev.preventDefault();
        this.setActive(this.active - 1);
        break;
      case 'Enter':
      case 'Tab':
        ev.preventDefault();
        ev.stopPropagation();
        this.select(this.options[this.active]);
        break;
      case 'Escape':
        // Que el ESC cierre el dropdown, no el modal.
        ev.stopPropagation();
        this.close();
        break;
    }
  }

  @HostListener('blur')
  onBlur() {
    // El click en una opción usa mousedown+preventDefault, así que el campo no
    // pierde el foco al seleccionar; cualquier otro blur cierra el dropdown.
    this.close();
  }

  // ---------- query detection ----------

  /** Query activa tras '@' (sin espacios) justo antes del caret, o null. */
  private currentQuery(): string | null {
    const before = this.textBeforeCaret();
    if (before == null) return null;
    const m = /(^|[\s(>])@([^\s@]{0,30})$/.exec(before);
    return m ? normalizeForMention(m[2]) : null;
  }

  private textBeforeCaret(): string | null {
    if (this.host instanceof HTMLTextAreaElement || this.host instanceof HTMLInputElement) {
      const pos = this.host.selectionStart;
      return pos == null ? null : this.host.value.slice(0, pos);
    }
    const sel = window.getSelection();
    if (
      !sel?.anchorNode ||
      !this.host.contains(sel.anchorNode) ||
      sel.anchorNode.nodeType !== Node.TEXT_NODE
    ) {
      return null;
    }
    return (sel.anchorNode.textContent ?? '').slice(0, sel.anchorOffset);
  }

  private refresh() {
    const q = this.currentQuery();
    if (q == null) {
      this.close();
      return;
    }
    const list = (this.members ?? []).filter((m) => {
      const name = normalizeForMention(m.name || '');
      return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
    });
    if (!list.length) {
      this.close();
      return;
    }
    this.options = list.slice(0, 8);
    this.active = 0;
    this.open();
  }

  // ---------- insertion ----------

  private select(member: Member | undefined) {
    if (!member) return;
    const insert = '@' + member.name + ' ';

    if (this.host instanceof HTMLTextAreaElement || this.host instanceof HTMLInputElement) {
      const pos = this.host.selectionStart ?? 0;
      const before = this.host.value.slice(0, pos);
      const m = /(^|[\s(>])@([^\s@]{0,30})$/.exec(before);
      if (m) {
        const start = m.index + m[1].length;
        this.host.value = this.host.value.slice(0, start) + insert + this.host.value.slice(pos);
        const caret = start + insert.length;
        this.host.setSelectionRange(caret, caret);
        // Notificar a ngModel/handlers que el valor cambió.
        this.host.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      if (sel && node && node.nodeType === Node.TEXT_NODE && this.host.contains(node)) {
        const text = node.textContent ?? '';
        const offset = sel.anchorOffset;
        const m = /(^|[\s(>])@([^\s@]{0,30})$/.exec(text.slice(0, offset));
        if (m) {
          const start = m.index + m[1].length;
          node.textContent = text.slice(0, start) + insert + text.slice(offset);
          const range = document.createRange();
          range.setStart(node, start + insert.length);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          this.host.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
    }
    this.close();
    this.host.focus();
  }

  // ---------- dropdown ----------

  private open() {
    if (!this.box) {
      this.box = document.createElement('div');
      this.box.className =
        'fixed z-[100] w-64 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover text-popover-foreground shadow-modal p-1';
      document.body.appendChild(this.box);
      document.addEventListener('scroll', this.onDocScroll, true);
      window.addEventListener('resize', this.onDocScroll);
    }
    const r = this.host.getBoundingClientRect();
    this.box.style.left = `${Math.round(r.left)}px`;
    this.box.style.top = `${Math.round(Math.min(r.bottom + 4, window.innerHeight - 240))}px`;
    this.render();
  }

  private setActive(i: number) {
    if (!this.options.length) return;
    this.active = (i + this.options.length) % this.options.length;
    this.render();
  }

  private render() {
    if (!this.box) return;
    this.box.innerHTML = '';
    this.options.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ' +
        (i === this.active ? 'bg-black/10' : 'hover:bg-black/5');
      const dot = document.createElement('span');
      dot.className =
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white';
      dot.style.backgroundColor = m.color || '#64748b';
      dot.textContent = this.initials(m.name);
      const label = document.createElement('span');
      label.className = 'truncate';
      label.textContent = m.name;
      btn.append(dot, label);
      // mousedown (no click) + preventDefault: el campo conserva el foco.
      btn.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        this.select(m);
      });
      this.box!.appendChild(btn);
    });
  }

  private close() {
    if (this.box) {
      this.box.remove();
      this.box = null;
      document.removeEventListener('scroll', this.onDocScroll, true);
      window.removeEventListener('resize', this.onDocScroll);
    }
    this.options = [];
    this.active = 0;
  }

  private initials(name: string | null | undefined): string {
    const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
}

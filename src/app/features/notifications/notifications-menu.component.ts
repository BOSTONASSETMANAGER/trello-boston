import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { RealtimeChannel } from '@supabase/supabase-js';
import { CurrentUserStore } from '../../core/current-user.store';
import { Notification } from '../../core/models/models';
import { NotificationsService } from '../../core/services/notifications.service';
import { ToastService } from '../../core/toast.service';
import { relativeTime } from '../../core/util/date';
import { AvatarComponent, IconComponent, PopoverComponent } from '../../shared/ui';

/**
 * Menú de notificaciones del navbar. Muestra un icono con un badge rojo de no
 * leídas y, al abrirlo, la lista de notificaciones del usuario actual con
 * soporte realtime. Estética Boston (navy/accent), OnPush, en español.
 */
@Component({
  selector: 'app-notifications-menu',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent, IconComponent, PopoverComponent],
  template: `
    <app-popover #pop="popover" align="end">
      <button
        trigger
        class="relative grid h-9 w-9 place-items-center rounded-md hover:bg-white/15 transition-colors"
        title="Notificaciones"
        aria-label="Notificaciones"
      >
        <app-icon name="inbox" [size]="18" />
        @if (unread() > 0) {
          <span
            class="absolute -top-1 -right-1 grid min-w-[18px] h-[18px] px-1 place-items-center rounded-full bg-red-500 text-white text-[10px] font-bold leading-none ring-2 ring-[#1d3969]"
          >
            {{ unread() > 99 ? '99+' : unread() }}
          </span>
        }
      </button>

      <div panel class="w-80 text-foreground">
        <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <h3 class="text-sm font-semibold">Notificaciones</h3>
          @if (unread() > 0) {
            <button
              (click)="markAllRead()"
              class="text-xs font-medium text-[#2563eb] hover:underline"
            >
              Marcar todas como leídas
            </button>
          }
        </div>

        <div class="max-h-96 overflow-y-auto">
          @if (items().length === 0) {
            <div class="flex flex-col items-center gap-2 px-4 py-10 text-center text-muted-foreground">
              <app-icon name="inbox" [size]="28" />
              <p class="text-sm">No tienes notificaciones</p>
            </div>
          } @else {
            @for (n of items(); track n.id) {
              <button
                (click)="open(n, pop)"
                class="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors"
                [class]="n.read ? 'hover:bg-muted/60' : 'bg-accent/10 hover:bg-accent/20'"
              >
                <app-avatar [member]="n.actor" [size]="32" />
                <div class="min-w-0 flex-1">
                  <p class="text-sm leading-snug">{{ textFor(n) }}</p>
                  <p class="mt-0.5 text-xs text-muted-foreground">{{ relative(n.created_at) }}</p>
                </div>
                @if (!n.read) {
                  <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#2563eb]"></span>
                }
              </button>
            }
          }
        </div>
      </div>
    </app-popover>
  `,
})
export class NotificationsMenuComponent implements OnDestroy {
  private notifications = inject(NotificationsService);
  private userStore = inject(CurrentUserStore);
  private router = inject(Router);
  private toast = inject(ToastService);

  readonly items = signal<Notification[]>([]);
  readonly unread = computed(() => this.items().filter((n) => !n.read).length);

  private channel: RealtimeChannel | null = null;
  private subscribedFor: string | null = null;

  constructor() {
    // Recarga la lista y (re)suscribe realtime cada vez que cambia el usuario.
    effect(() => {
      const memberId = this.userStore.currentId();
      this.resetForMember(memberId);
    });
  }

  ngOnDestroy() {
    this.teardown();
  }

  textFor(n: Notification): string {
    const actor = n.actor?.name ?? 'Alguien';
    const title = n.data?.['title'] ?? '';
    switch (n.type) {
      case 'card.assigned':
        return `${actor} te asignó la tarjeta «${title}»`;
      case 'card.commented':
        return `${actor} comentó en «${title}»`;
      case 'card.mentioned':
        return title ? `${actor} te mencionó en «${title}»` : `${actor} te mencionó`;
      default:
        return n.type;
    }
  }

  relative(iso: string | null | undefined): string {
    return relativeTime(iso);
  }

  async open(n: Notification, pop: PopoverComponent) {
    pop.close();
    try {
      if (!n.read) {
        await this.notifications.markRead(n.id);
      }
      if (n.board_id && n.card_id) {
        this.router.navigate(['/board', n.board_id, 'card', n.card_id]);
      }
      await this.reload();
    } catch {
      this.toast.error('No se pudo abrir la notificación');
    }
  }

  async markAllRead() {
    const memberId = this.userStore.currentId();
    if (!memberId) return;
    try {
      await this.notifications.markAllRead(memberId);
      await this.reload();
    } catch {
      this.toast.error('No se pudieron marcar como leídas');
    }
  }

  private resetForMember(memberId: string | null) {
    if (memberId === this.subscribedFor) return;
    this.teardown();
    this.subscribedFor = memberId;
    if (!memberId) {
      this.items.set([]);
      return;
    }
    void this.reload();
    try {
      this.channel = this.notifications.subscribe(memberId, () => void this.reload());
    } catch {
      // Realtime es opcional; si falla seguimos con carga manual.
    }
  }

  private async reload() {
    const memberId = this.userStore.currentId();
    if (!memberId) {
      this.items.set([]);
      return;
    }
    try {
      const list = await this.notifications.listForMember(memberId);
      this.items.set(list ?? []);
    } catch {
      // Silencioso: no molestamos con un toast en cada recarga fallida.
    }
  }

  private teardown() {
    if (this.channel) {
      try {
        this.notifications.unsubscribe(this.channel);
      } catch {
        // ignore
      }
      this.channel = null;
    }
  }
}

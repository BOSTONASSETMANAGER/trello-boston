import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ChromeService } from '../../core/chrome.service';
import { CurrentUserStore } from '../../core/current-user.store';
import { ThemeService } from '../../core/theme.service';
import { ToastService } from '../../core/toast.service';
import { NotificationsMenuComponent } from '../../features/notifications/notifications-menu.component';
import { AvatarComponent } from '../ui/avatar.component';
import { IconComponent } from '../ui/icon.component';
import { PopoverComponent } from '../ui/popover.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, AvatarComponent, IconComponent, PopoverComponent, NotificationsMenuComponent],
  template: `
    <header
      class="h-14 shrink-0 text-white flex items-center px-4 gap-3 shadow-sm z-30 relative transition-colors duration-300"
      [style.backgroundColor]="chrome.navColor()"
    >
      <a routerLink="/boards" class="flex items-center">
        <img src="/boston-logo-light.png" alt="Boston Boards" class="h-8 w-auto" />
      </a>

      <a routerLink="/boards"
         class="ml-2 hidden sm:inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-sm bg-white/10 hover:bg-white/20 transition-colors">
        <app-icon name="inbox" [size]="15" /> Tableros
      </a>

      <a routerLink="/my-cards"
         class="hidden sm:inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-sm bg-white/10 hover:bg-white/20 transition-colors">
        <app-icon name="check-square" [size]="15" /> Mis tarjetas
      </a>

      <div class="flex-1"></div>

      <button
        (click)="theme.toggle()"
        class="grid h-9 w-9 place-items-center rounded-md hover:bg-white/15 transition-colors"
        [title]="theme.dark() ? 'Modo claro' : 'Modo oscuro'"
      >
        <app-icon [name]="theme.dark() ? 'sun' : 'moon'" [size]="18" />
      </button>

      <app-notifications-menu />

      <app-popover #userPop="popover" align="end">
        <button trigger class="flex items-center gap-2 rounded-md pl-1 pr-2 h-9 hover:bg-white/15 transition-colors">
          <app-avatar [member]="user.current()" [size]="28" />
          <span class="hidden sm:block text-sm font-medium max-w-[8rem] truncate">{{ user.current()?.name || 'Invitado' }}</span>
          <app-icon name="chevron-down" [size]="15" />
        </button>
        <div panel class="w-64 p-2">
          <div class="flex items-center gap-2 px-2 py-2">
            <app-avatar [member]="user.current()" [size]="36" />
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-foreground">{{ user.current()?.name }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ user.current()?.email }}</p>
            </div>
          </div>
          @if (user.isAdmin()) {
            <div class="my-1 h-px bg-border"></div>
            <a
              routerLink="/usuarios"
              (click)="userPop.close()"
              class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-foreground hover:bg-accent"
            >
              <app-icon name="users" [size]="16" /> Usuarios
            </a>
          }
          <div class="my-1 h-px bg-border"></div>
          <button
            (click)="logout(); userPop.close()"
            class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            <app-icon name="log-out" [size]="16" /> Cerrar sesión
          </button>
        </div>
      </app-popover>
    </header>
  `,
})
export class NavbarComponent {
  user = inject(CurrentUserStore);
  theme = inject(ThemeService);
  chrome = inject(ChromeService);
  private auth = inject(AuthService);
  private router = inject(Router);
  private toast = inject(ToastService);

  async logout() {
    try {
      await this.auth.signOut();
      this.router.navigateByUrl('/login');
    } catch {
      this.toast.error('No se pudo cerrar la sesión');
    }
  }
}

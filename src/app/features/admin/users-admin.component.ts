import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CurrentUserStore } from '../../core/current-user.store';
import { MembersService } from '../../core/services/members.service';
import { ToastService } from '../../core/toast.service';
import { Member, MemberRole } from '../../core/models/models';
import { AvatarComponent } from '../../shared/ui/avatar.component';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * Panel de administración de roles. Visible solo para admins; la protección
 * real está en la base (RLS + trigger que solo deja a admins cambiar roles).
 */
@Component({
  selector: 'app-users-admin',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AvatarComponent, IconComponent],
  template: `
    <section class="mx-auto min-h-full max-w-3xl bg-background px-6 py-8">
      @if (!user.isAdmin()) {
        <div class="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <app-icon name="users" [size]="28" />
          <h1 class="text-lg font-semibold text-foreground">Solo administradores</h1>
          <p class="text-sm text-muted-foreground">No tienes permisos para gestionar usuarios.</p>
        </div>
      } @else {
        <header class="mb-6">
          <h1 class="text-2xl font-bold tracking-tight text-foreground">Usuarios</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Los administradores ven y gestionan todos los tableros; los empleados solo los tableros donde son miembros.
          </p>
        </header>

        <ul class="divide-y divide-border rounded-xl border border-border bg-card">
          @for (m of user.members(); track m.id) {
            <li class="flex items-center gap-3 px-4 py-3">
              <app-avatar [member]="m" [size]="32" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-foreground">{{ m.name }}</p>
                <p class="truncate text-xs text-muted-foreground">{{ m.email }}</p>
              </div>
              <select
                class="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                [value]="m.role ?? 'empleado'"
                [disabled]="m.id === user.currentId() || saving() === m.id"
                (change)="changeRole(m, $event)"
                [title]="m.id === user.currentId() ? 'No puedes cambiar tu propio rol' : 'Cambiar rol'"
              >
                <option value="admin">Admin</option>
                <option value="empleado">Empleado</option>
              </select>
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class UsersAdminComponent {
  user = inject(CurrentUserStore);
  private membersSvc = inject(MembersService);
  private toast = inject(ToastService);

  readonly saving = signal<string | null>(null);

  async changeRole(member: Member, event: Event) {
    const role = (event.target as HTMLSelectElement).value as MemberRole;
    if (role === (member.role ?? 'empleado')) return;
    this.saving.set(member.id);
    try {
      await this.membersSvc.updateRole(member.id, role);
      this.user.updateMember({ ...member, role });
      this.toast.success(`${member.name} ahora es ${role}`);
    } catch {
      this.toast.error('No se pudo cambiar el rol');
      (event.target as HTMLSelectElement).value = member.role ?? 'empleado';
    } finally {
      this.saving.set(null);
    }
  }
}

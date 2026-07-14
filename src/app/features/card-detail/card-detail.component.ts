import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import {
  AvatarComponent,
  BadgeComponent,
  ButtonComponent,
  IconComponent,
  MentionsDirective,
  ModalComponent,
  PopoverComponent,
  SpinnerComponent,
} from '../../shared/ui';

import {
  Attachment,
  AttachmentType,
  Board,
  Card,
  CardCoverSize,
  Label,
  LABEL_COLORS,
  List,
  Member,
} from '../../core/models/models';
import { formatDue, isDueSoon, isOverdue, relativeTime, toDateTimeLocal, fromDateTimeLocal } from '../../core/util/date';
import { extractMentions, htmlToText, newMentions } from '../../core/util/mentions';

import { BoardStore } from '../../core/board.store';
import { CardsService } from '../../core/services/cards.service';
import { LabelsService } from '../../core/services/labels.service';
import { ChecklistsService } from '../../core/services/checklists.service';
import { CommentsService } from '../../core/services/comments.service';
import { ActivityService } from '../../core/services/activity.service';
import { StorageService } from '../../core/services/storage.service';
import { AttachmentsService } from '../../core/services/attachments.service';
import { NotificationsService } from '../../core/services/notifications.service';
import { BoardsService } from '../../core/services/boards.service';
import { ListsService } from '../../core/services/lists.service';
import { CurrentUserStore } from '../../core/current-user.store';
import { ToastService } from '../../core/toast.service';

import { ChecklistPanelComponent } from './panels/checklist-panel.component';

/**
 * Card detail modal — child route of board/:id.
 * Reads `cardId` from the route, loads the full card and renders a Trello-style
 * detail modal with members, labels, due date, cover, description, checklists
 * and comments. All writes go through the core services and refresh both the
 * local signal and the BoardStore so the board behind the modal stays in sync.
 */
@Component({
  selector: 'app-card-detail',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ModalComponent,
    PopoverComponent,
    ButtonComponent,
    IconComponent,
    AvatarComponent,
    BadgeComponent,
    SpinnerComponent,
    ChecklistPanelComponent,
    MentionsDirective,
  ],
  template: `
    <app-modal [open]="true" width="max-w-5xl" (closed)="close()">
      @if (loading()) {
        <div class="flex h-64 items-center justify-center">
          <app-spinner [size]="36" />
        </div>
      } @else if (card(); as c) {
        <!-- Cover -->
        @if (c.cover_color) {
          <div
            class="rounded-t-xl transition-all"
            [class.h-12]="c.cover_size !== 'full'"
            [class.h-24]="c.cover_size === 'full'"
            [style.backgroundColor]="c.cover_color"
          ></div>
        }

        <div class="p-5 sm:p-6">
          <!-- Close button -->
          <button
            class="absolute right-3 top-3 rounded-full p-1.5 text-slate-500 hover:bg-black/5"
            [class.text-white]="c.cover_color"
            title="Cerrar"
            (click)="close()"
          >
            <app-icon name="x" [size]="18" />
          </button>

          <!-- Header -->
          <div class="mb-5 flex items-start gap-3 pr-8">
            <app-icon name="align-left" [size]="20" class="mt-1.5 text-slate-500" />
            <div class="flex-1">
              <textarea
                class="w-full resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-xl font-semibold text-card-foreground hover:bg-black/5 focus:border-[#2563eb] focus:bg-card focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                rows="1"
                [(ngModel)]="titleDraft"
                (blur)="saveTitle()"
                (keydown.enter)="saveTitle(); $event.preventDefault()"
              ></textarea>
              @if (listName(); as ln) {
                <p class="mt-0.5 px-2 text-sm text-slate-500">
                  en la lista <span class="font-medium underline">{{ ln }}</span>
                </p>
              }
            </div>
          </div>

          <!-- Two columns -->
          <div class="md:grid md:grid-cols-[1fr_200px] md:gap-6">
            <!-- ===================== MAIN COLUMN ===================== -->
            <!-- min-w-0: sin esto, la columna 1fr no puede encoger por debajo
                 de su contenido (URLs/código largos) y empuja el sidebar fuera
                 del modal. -->
            <div class="min-w-0 space-y-6">
              <!-- Summary: members + labels -->
              @if ((c.members?.length || c.labels?.length)) {
                <div class="flex flex-wrap gap-6">
                  @if (c.members?.length) {
                    <div>
                      <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Miembros
                      </h3>
                      <div class="flex -space-x-1">
                        @for (m of c.members; track m.id) {
                          <app-avatar [member]="m" [size]="32" />
                        }
                      </div>
                    </div>
                  }
                  @if (c.labels?.length) {
                    <div>
                      <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Etiquetas
                      </h3>
                      <div class="flex flex-wrap gap-1.5">
                        @for (l of c.labels; track l.id) {
                          <app-badge [color]="l.color" [label]="l.name || ''" />
                        }
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- Due date summary -->
              @if (c.due_date) {
                <div>
                  <h3 class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Fecha de entrega
                  </h3>
                  <span
                    class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium"
                    [class]="dueClasses(c)"
                  >
                    <app-icon name="clock" [size]="14" />
                    {{ formatDue(c.due_date) }}
                    @if (c.due_complete) { <span class="ml-1">(Completada)</span> }
                    @else if (overdue(c)) { <span class="ml-1">(Vencida)</span> }
                  </span>
                </div>
              }

              <!-- Description -->
              <section>
                <div class="mb-2 flex items-center gap-2">
                  <app-icon name="align-left" [size]="18" class="text-slate-500" />
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Descripción
                  </h3>
                </div>
                @if (editingDesc()) {
                  <textarea
                    class="w-full resize-y rounded-md border border-slate-300 bg-card px-3 py-2 text-sm focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    rows="4"
                    placeholder="Añade una descripción más detallada… (@ para mencionar)"
                    [(ngModel)]="descDraft"
                    [appMentions]="allMembers()"
                  ></textarea>
                  <div class="mt-2 flex items-center gap-2">
                    <app-button size="sm" variant="primary" (click)="saveDesc()">Guardar</app-button>
                    <app-button size="sm" variant="ghost" (click)="editingDesc.set(false)">Cancelar</app-button>
                  </div>
                } @else {
                  <div
                    class="cursor-pointer rounded-md bg-slate-50 px-3 py-2.5 text-sm hover:bg-slate-100"
                    (click)="startEditDesc(c)"
                  >
                    @if (c.description) {
                      <p class="whitespace-pre-wrap break-words text-card-foreground">{{ c.description }}</p>
                    } @else {
                      <p class="text-slate-400">Añade una descripción…</p>
                    }
                  </div>
                }
              </section>

              <!-- General (contenido enriquecido) -->
              <section>
                <div class="mb-2 flex items-center gap-2">
                  <app-icon name="align-left" [size]="18" class="text-slate-500" />
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    General
                  </h3>
                </div>
                <div class="relative">
                  <div
                    #richEditor
                    class="prose-sm min-h-[120px] w-full overflow-x-auto break-words rounded-md border border-slate-300 bg-card px-3 py-2.5 text-sm leading-relaxed text-card-foreground focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    [contentEditable]="true"
                    [innerHTML]="bodyHtmlSafe()"
                    [appMentions]="allMembers()"
                    (input)="onRichInput(richEditor)"
                    (paste)="onRichPaste($event, richEditor)"
                    (blur)="saveBodyHtml(c, richEditor)"
                  ></div>
                  @if (bodyEmpty()) {
                    <span class="pointer-events-none absolute left-3 top-2.5 text-sm text-slate-400">
                      Escribe contenido enriquecido… puedes pegar imágenes directamente.
                    </span>
                  }
                  @if (uploadingPaste()) {
                    <span class="mt-1 inline-flex items-center gap-1.5 text-xs text-slate-500">
                      <app-spinner [size]="14" /> Subiendo imagen…
                    </span>
                  }
                </div>
              </section>

              <!-- Progreso -->
              <section>
                <div class="mb-2 flex items-center gap-2">
                  <app-icon name="activity" [size]="18" class="text-slate-500" />
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Progreso de la tarea
                  </h3>
                </div>
                <div class="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    class="h-2 flex-1 cursor-pointer accent-[#2563eb]"
                    [value]="progressValue(c)"
                    (input)="onProgressInput($event)"
                    (change)="saveProgress(c, $event)"
                  />
                  <span class="w-12 text-right text-sm font-semibold tabular-nums text-card-foreground">
                    {{ progressDraft() }}%
                  </span>
                </div>
                <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    class="h-full rounded-full transition-all"
                    [style.width.%]="progressDraft()"
                    [style.backgroundColor]="progressDraft() >= 100 ? '#22c55e' : '#2563eb'"
                  ></div>
                </div>
              </section>

              <!-- Adjuntos -->
              <section>
                <div class="mb-3 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <app-icon name="paperclip" [size]="18" class="text-slate-500" />
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Adjuntos
                    </h3>
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      #fileInput
                      type="file"
                      class="hidden"
                      accept="image/*,video/*"
                      multiple
                      (change)="onFilesSelected(c, $event, fileInput)"
                    />
                    <app-button size="sm" variant="subtle" (click)="fileInput.click()" [disabled]="uploadingFile()">
                      <app-icon name="paperclip" [size]="14" /> Subir archivo
                    </app-button>
                    <app-popover #linkPop="popover" align="end">
                      <button
                        trigger
                        type="button"
                        class="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-100 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200"
                      >
                        <app-icon name="tag" [size]="14" /> Añadir enlace
                      </button>
                      <div panel class="w-72 p-3">
                        <span class="mb-2 block text-sm font-semibold">Añadir enlace</span>
                        <input
                          class="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                          placeholder="Nombre (opcional)"
                          [(ngModel)]="linkName"
                        />
                        <input
                          class="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                          placeholder="https://…"
                          [(ngModel)]="linkUrl"
                        />
                        <app-button size="sm" variant="primary" block (click)="addLink(c, linkPop)">
                          Añadir
                        </app-button>
                      </div>
                    </app-popover>
                  </div>
                </div>

                @if (uploadingFile()) {
                  <p class="mb-2 inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <app-spinner [size]="14" /> Subiendo archivo…
                  </p>
                }

                @if (attachments().length) {
                  <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    @for (a of attachments(); track a.id) {
                      <div class="group relative overflow-hidden rounded-md border border-border bg-slate-50">
                        @if (a.type === 'image') {
                          <a [href]="a.url" target="_blank" rel="noopener">
                            <img [src]="a.url" [alt]="a.name" class="h-28 w-full object-cover" />
                          </a>
                        } @else if (a.type === 'video') {
                          <video [src]="a.url" controls class="h-28 w-full bg-black object-cover"></video>
                        } @else {
                          <a
                            [href]="a.url"
                            target="_blank"
                            rel="noopener"
                            class="flex h-28 w-full flex-col items-center justify-center gap-2 p-2 text-center text-sm text-[#2563eb] hover:bg-slate-100"
                          >
                            <app-icon name="tag" [size]="22" />
                            <span class="line-clamp-2 break-all">{{ a.name }}</span>
                          </a>
                        }
                        <div class="flex items-center justify-between gap-1 px-2 py-1">
                          <span class="truncate text-xs text-slate-600" [title]="a.name">{{ a.name }}</span>
                          <button
                            class="shrink-0 rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Eliminar adjunto"
                            (click)="deleteAttachment(a)"
                          >
                            <app-icon name="trash" [size]="14" />
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="text-sm text-slate-400">Sin adjuntos todavía.</p>
                }
              </section>

              <!-- Checklists -->
              <section>
                <div class="mb-3 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <app-icon name="check-square" [size]="18" class="text-slate-500" />
                    <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
                      Checklists
                    </h3>
                  </div>
                  <app-button size="sm" variant="subtle" (click)="addChecklist(c)">
                    <app-icon name="plus" [size]="14" /> Agregar checklist
                  </app-button>
                </div>
                <div class="space-y-5">
                  @for (cl of c.checklists; track cl.id) {
                    <app-checklist-panel [checklist]="cl" (changed)="reload()" />
                  } @empty {
                    <p class="text-sm text-slate-400">Sin checklists todavía.</p>
                  }
                </div>
              </section>

              <!-- Comments -->
              <section>
                <div class="mb-3 flex items-center gap-2">
                  <app-icon name="message" [size]="18" class="text-slate-500" />
                  <h3 class="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Comentarios
                  </h3>
                </div>

                <!-- Composer -->
                <div class="flex items-start gap-2">
                  <app-avatar [member]="currentUser()" [size]="32" />
                  <div class="flex-1">
                    <textarea
                      class="w-full resize-none rounded-md border border-slate-300 bg-card px-3 py-2 text-sm focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                      rows="2"
                      placeholder="Escribe un comentario… (@ para mencionar)"
                      [(ngModel)]="commentDraft"
                      [appMentions]="allMembers()"
                      (keydown.enter)="$any($event).ctrlKey && addComment(c)"
                    ></textarea>
                    <div class="mt-1.5">
                      <app-button
                        size="sm"
                        variant="primary"
                        [disabled]="!commentDraft.trim() || sendingComment()"
                        (click)="addComment(c)"
                      >
                        <app-icon name="send" [size]="14" /> Enviar
                      </app-button>
                    </div>
                  </div>
                </div>

                <!-- List -->
                <ul class="mt-4 space-y-4">
                  @for (cm of c.comments; track cm.id) {
                    <li class="flex items-start gap-2">
                      <app-avatar [member]="cm.member" [size]="32" />
                      <div class="flex-1">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-semibold text-card-foreground">
                            {{ cm.member?.name || 'Alguien' }}
                          </span>
                          <span class="text-xs text-slate-400">{{ relativeTime(cm.created_at) }}</span>
                        </div>
                        <div class="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm">
                          <p class="whitespace-pre-wrap break-words text-card-foreground">{{ cm.body }}</p>
                        </div>
                        @if (cm.member_id === currentId()) {
                          <button
                            class="mt-1 text-xs text-slate-400 hover:text-red-600 hover:underline"
                            (click)="deleteComment(cm.id)"
                          >
                            Eliminar
                          </button>
                        }
                      </div>
                    </li>
                  } @empty {
                    <li class="text-sm text-slate-400">Sin comentarios todavía.</li>
                  }
                </ul>
              </section>
            </div>

            <!-- ===================== SIDEBAR ===================== -->
            <aside class="mt-6 space-y-1 md:mt-0">
              <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Añadir a la tarjeta
              </h3>

              <!-- Members -->
              <app-popover #membersPop="popover" align="end" block>
                <button trigger [class]="sideBtn">
                  <app-icon name="users" [size]="16" /> Miembros
                </button>
                <div panel class="w-64 p-3">
                  <div class="mb-2 flex items-center justify-between">
                    <span class="text-sm font-semibold">Miembros</span>
                  </div>
                  <button
                    class="mb-2 w-full rounded-md bg-slate-100 px-2 py-1.5 text-left text-sm hover:bg-slate-200"
                    (click)="assignSelf(c)"
                  >
                    Asignarme
                  </button>
                  <ul class="max-h-60 space-y-0.5 overflow-y-auto">
                    @for (m of allMembers(); track m.id) {
                      <li>
                        <button
                          class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
                          (click)="toggleMember(c, m)"
                        >
                          <app-avatar [member]="m" [size]="24" />
                          <span class="flex-1 truncate">{{ m.name }}</span>
                          @if (hasMember(c, m.id)) {
                            <app-icon name="check" [size]="16" class="text-[#2563eb]" />
                          }
                        </button>
                      </li>
                    }
                  </ul>
                </div>
              </app-popover>

              <!-- Labels -->
              <app-popover #labelsPop="popover" align="end" block>
                <button trigger [class]="sideBtn">
                  <app-icon name="tag" [size]="16" /> Etiquetas
                </button>
                <div panel class="w-64 p-3">
                  <span class="mb-2 block text-sm font-semibold">Etiquetas</span>
                  <ul class="mb-3 max-h-52 space-y-1 overflow-y-auto">
                    @for (l of boardLabels(); track l.id) {
                      <li>
                        <button
                          class="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-black/5"
                          (click)="toggleLabel(c, l)"
                        >
                          <span
                            class="h-6 flex-1 rounded-md px-2 text-xs font-medium leading-6 text-white"
                            [style.backgroundColor]="l.color"
                          >{{ l.name || '' }}</span>
                          @if (hasLabel(c, l.id)) {
                            <app-icon name="check" [size]="16" class="text-[#2563eb]" />
                          }
                        </button>
                      </li>
                    }
                  </ul>
                  <!-- Create label -->
                  <div class="border-t border-border pt-2">
                    <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Crear etiqueta
                    </span>
                    <input
                      class="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                      placeholder="Nombre (opcional)"
                      [(ngModel)]="newLabelName"
                    />
                    <div class="mb-2 grid grid-cols-8 gap-1">
                      @for (color of palette; track color) {
                        <button
                          class="h-6 w-full rounded"
                          [style.backgroundColor]="color"
                          [class.ring-2]="newLabelColor === color"
                          [class.ring-offset-1]="newLabelColor === color"
                          [style.--tw-ring-color]="'#2563eb'"
                          (click)="newLabelColor = color"
                        ></button>
                      }
                    </div>
                    <app-button size="sm" variant="primary" block (click)="createLabel(c)">
                      Crear y añadir
                    </app-button>
                  </div>
                </div>
              </app-popover>

              <!-- Due date -->
              <app-popover #duePop="popover" align="end" block>
                <button trigger [class]="sideBtn">
                  <app-icon name="calendar" [size]="16" /> Fecha de entrega
                </button>
                <div panel class="w-64 p-3">
                  <span class="mb-2 block text-sm font-semibold">Fecha de entrega</span>
                  <input
                    type="datetime-local"
                    class="mb-2 w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-[#2563eb] focus:outline-none focus:ring-1 focus:ring-[#2563eb]"
                    [(ngModel)]="dueDraft"
                  />
                  <label class="mb-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      class="h-4 w-4 rounded border-slate-300 text-[#2563eb] focus:ring-[#2563eb]"
                      [checked]="c.due_complete"
                      (change)="toggleDueComplete(c, $event)"
                    />
                    Completada
                  </label>
                  <div class="flex gap-2">
                    <app-button size="sm" variant="primary" block (click)="saveDue(c, duePop)">
                      Guardar
                    </app-button>
                    @if (c.due_date) {
                      <app-button size="sm" variant="ghost" (click)="clearDue(c, duePop)">
                        Quitar
                      </app-button>
                    }
                  </div>
                </div>
              </app-popover>

              <!-- Cover -->
              <app-popover #coverPop="popover" align="end" block>
                <button trigger [class]="sideBtn">
                  <app-icon name="eye" [size]="16" /> Cubierta
                </button>
                <div panel class="w-64 p-3">
                  <span class="mb-2 block text-sm font-semibold">Cubierta</span>

                  <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tamaño
                  </span>
                  <div class="mb-3 grid grid-cols-2 gap-1.5">
                    <button
                      class="rounded-md border border-border p-1 disabled:opacity-40"
                      [class.ring-2]="c.cover_size !== 'full'"
                      [style.--tw-ring-color]="'#2563eb'"
                      [disabled]="!c.cover_color"
                      title="Franja superior"
                      (click)="setCoverSize(c, 'strip')"
                    >
                      <span class="block h-8 overflow-hidden rounded bg-slate-100 dark:bg-slate-600">
                        <span
                          class="block h-2"
                          [style.backgroundColor]="c.cover_color || '#94a3b8'"
                        ></span>
                      </span>
                    </button>
                    <button
                      class="rounded-md border border-border p-1 disabled:opacity-40"
                      [class.ring-2]="c.cover_size === 'full'"
                      [style.--tw-ring-color]="'#2563eb'"
                      [disabled]="!c.cover_color"
                      title="Tarjeta completa"
                      (click)="setCoverSize(c, 'full')"
                    >
                      <span
                        class="block h-8 rounded"
                        [style.backgroundColor]="c.cover_color || '#94a3b8'"
                      ></span>
                    </button>
                  </div>

                  <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Color
                  </span>
                  <div class="mb-2 grid grid-cols-8 gap-1">
                    @for (color of palette; track color) {
                      <button
                        class="h-7 w-full rounded"
                        [style.backgroundColor]="color"
                        [class.ring-2]="c.cover_color === color"
                        [class.ring-offset-1]="c.cover_color === color"
                        [style.--tw-ring-color]="'#2563eb'"
                        (click)="setCover(c, color, coverPop)"
                      ></button>
                    }
                  </div>
                  <label
                    class="mb-2 flex cursor-pointer items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    Personalizado
                    <input
                      #coverPicker
                      type="color"
                      class="h-6 w-9 cursor-pointer rounded border-0 bg-transparent p-0"
                      [value]="c.cover_color || '#2563eb'"
                      (change)="setCover(c, coverPicker.value, coverPop)"
                    />
                  </label>
                  @if (c.cover_color) {
                    <app-button size="sm" variant="ghost" block (click)="setCover(c, null, coverPop)">
                      Quitar cubierta
                    </app-button>
                  }
                </div>
              </app-popover>

              <!-- Mover a tablero -->
              <app-popover #movePop="popover" align="end" block>
                <button trigger [class]="sideBtn" (click)="openMove()">
                  <app-icon name="arrow-left" [size]="16" /> Mover
                </button>
                <div panel class="w-72 p-3">
                  <span class="mb-2 block text-sm font-semibold">Mover tarjeta</span>

                  @if (loadingMove()) {
                    <div class="flex justify-center py-4"><app-spinner [size]="22" /></div>
                  } @else {
                    <!-- Step 1: pick board -->
                    <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Tablero
                    </span>
                    <ul class="mb-3 max-h-40 space-y-0.5 overflow-y-auto">
                      @for (b of moveBoards(); track b.id) {
                        <li>
                          <button
                            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
                            [class.bg-slate-100]="moveBoard()?.id === b.id"
                            (click)="selectMoveBoard(b)"
                          >
                            <app-icon name="layout" [size]="14" class="text-slate-500" />
                            <span class="flex-1 truncate">{{ b.title }}</span>
                            @if (moveBoard()?.id === b.id) {
                              <app-icon name="check" [size]="14" class="text-[#2563eb]" />
                            }
                          </button>
                        </li>
                      } @empty {
                        <li class="px-2 py-1 text-sm text-slate-400">Sin tableros.</li>
                      }
                    </ul>

                    <!-- Step 2: pick list -->
                    @if (moveBoard()) {
                      <span class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Lista de destino
                      </span>
                      @if (loadingMoveLists()) {
                        <div class="flex justify-center py-3"><app-spinner [size]="18" /></div>
                      } @else {
                        <ul class="max-h-40 space-y-0.5 overflow-y-auto">
                          @for (l of moveLists(); track l.id) {
                            <li>
                              <button
                                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
                                [disabled]="moving()"
                                (click)="doMove(c, l, movePop)"
                              >
                                <app-icon name="list" [size]="14" class="text-slate-500" />
                                <span class="flex-1 truncate">{{ l.title }}</span>
                              </button>
                            </li>
                          } @empty {
                            <li class="px-2 py-1 text-sm text-slate-400">Este tablero no tiene listas.</li>
                          }
                        </ul>
                      }
                    }
                  }
                </div>
              </app-popover>

              <div class="my-2 border-t border-border"></div>

              <!-- Actions -->
              <button [class]="sideBtn" (click)="archive(c)">
                <app-icon name="archive" [size]="16" /> Archivar
              </button>
              <button [class]="sideBtnDanger" (click)="remove(c)">
                <app-icon name="trash" [size]="16" /> Eliminar
              </button>
            </aside>
          </div>
        </div>
      }
    </app-modal>
  `,
})
export class CardDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private store = inject(BoardStore);
  private cardsSvc = inject(CardsService);
  private labelsSvc = inject(LabelsService);
  private checklistsSvc = inject(ChecklistsService);
  private commentsSvc = inject(CommentsService);
  private activitySvc = inject(ActivityService);
  private storageSvc = inject(StorageService);
  private attachmentsSvc = inject(AttachmentsService);
  private notificationsSvc = inject(NotificationsService);
  private boardsSvc = inject(BoardsService);
  private listsSvc = inject(ListsService);
  private currentUserStore = inject(CurrentUserStore);
  private toast = inject(ToastService);
  private sanitizer = inject(DomSanitizer);

  // template helpers
  readonly formatDue = formatDue;
  readonly relativeTime = relativeTime;
  readonly palette = LABEL_COLORS;
  readonly sideBtn =
    'flex w-full items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-200';
  readonly sideBtnDanger =
    'flex w-full items-center gap-2 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50';

  // state
  readonly card = signal<Card | null>(null);
  readonly loading = signal(true);

  // drafts
  titleDraft = '';
  descDraft = '';
  editingDesc = signal(false);
  commentDraft = '';
  sendingComment = signal(false);
  newLabelName = '';
  newLabelColor: string = LABEL_COLORS[8];
  dueDraft = '';

  // ---- General (rich content) ----
  /** Snapshot HTML used to seed the contenteditable; only updates on card (re)load
   *  so typing/blur-saving never resets the cursor mid-edit. */
  private readonly bodyHtmlSeed = signal<string>('');
  readonly bodyEmpty = signal(true);
  readonly uploadingPaste = signal(false);
  readonly bodyHtmlSafe = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.bodyHtmlSeed() || ''),
  );

  // ---- Progress ----
  readonly progressDraft = signal(0);

  // ---- Attachments ----
  readonly attachments = signal<Attachment[]>([]);
  readonly uploadingFile = signal(false);
  linkName = '';
  linkUrl = '';

  // ---- Move to board ----
  readonly moveBoards = signal<Board[]>([]);
  readonly moveBoard = signal<Board | null>(null);
  readonly moveLists = signal<List[]>([]);
  readonly loadingMove = signal(false);
  readonly loadingMoveLists = signal(false);
  readonly moving = signal(false);

  // derived from store
  readonly allMembers = this.store.allMembers;
  readonly boardLabels = this.store.labels;
  readonly currentUser = this.currentUserStore.current;
  readonly currentId = this.currentUserStore.currentId;

  readonly listName = computed(() => {
    const c = this.card();
    if (!c) return null;
    return this.store.lists().find((l) => l.id === c.list_id)?.title ?? null;
  });

  constructor() {
    this.route.paramMap.subscribe((params) => {
      const cardId = params.get('cardId');
      if (cardId) this.load(cardId);
    });
  }

  // ---------- loading ----------
  private async load(cardId: string) {
    this.loading.set(true);
    try {
      const card = await this.cardsSvc.getFull(cardId);
      if (!card) {
        this.toast.error('La tarjeta no existe');
        this.close();
        return;
      }
      this.card.set(card);
      this.titleDraft = card.title;
      this.dueDraft = toDateTimeLocal(card.due_date);
      this.seedRichState(card);
    } catch (e: any) {
      this.toast.error('Error cargando la tarjeta: ' + (e?.message ?? e));
      this.close();
    } finally {
      this.loading.set(false);
    }
  }

  async reload() {
    const c = this.card();
    if (!c) return;
    try {
      const fresh = await this.cardsSvc.getFull(c.id);
      if (fresh) {
        this.card.set(fresh);
        this.dueDraft = toDateTimeLocal(fresh.due_date);
        // Refresh progress + attachments, but keep the editor's HTML seed
        // intact so an in-progress edit never has its cursor reset.
        this.progressDraft.set(fresh.progress ?? 0);
        this.attachments.set(fresh.attachments ?? []);
      }
    } catch {
      /* ignore */
    }
    this.store.reload();
  }

  close() {
    const boardId = this.card()?.board_id ?? this.store.board()?.id;
    if (boardId) this.router.navigate(['/board', boardId]);
    else this.router.navigate(['/']);
  }

  // ---------- title ----------
  async saveTitle() {
    const c = this.card();
    if (!c) return;
    const title = this.titleDraft.trim();
    if (!title || title === c.title) {
      this.titleDraft = c.title;
      return;
    }
    try {
      await this.cardsSvc.update(c.id, { title });
      this.card.update((x) => (x ? { ...x, title } : x));
      this.store.patchCard(c.id, { title });
    } catch (e: any) {
      this.toast.error('No se pudo guardar el título');
    }
  }

  // ---------- description ----------
  startEditDesc(c: Card) {
    this.descDraft = c.description ?? '';
    this.editingDesc.set(true);
  }

  async saveDesc() {
    const c = this.card();
    if (!c) return;
    const description = this.descDraft;
    this.editingDesc.set(false);
    // Solo se notifica a quien aparece mencionado por primera vez.
    const mentioned = newMentions(c.description, description, this.allMembers());
    try {
      await this.cardsSvc.update(c.id, { description });
      this.card.update((x) => (x ? { ...x, description } : x));
      this.store.patchCard(c.id, { description });
      await this.notifyMentions(c, mentioned);
    } catch (e: any) {
      this.toast.error('No se pudo guardar la descripción');
    }
  }

  // ---------- checklists ----------
  async addChecklist(c: Card) {
    const existing = c.checklists ?? [];
    const maxPos = existing.length ? Math.max(...existing.map((cl) => cl.position)) : 0;
    try {
      await this.checklistsSvc.create(c.id, 'Checklist', maxPos + 1000);
      await this.reload();
    } catch (e: any) {
      this.toast.error('No se pudo crear el checklist');
    }
  }

  // ---------- comments ----------
  async addComment(c: Card) {
    const body = this.commentDraft.trim();
    if (!body) return;
    const memberId = this.currentId();
    this.sendingComment.set(true);
    try {
      await this.commentsSvc.add(c.id, memberId, body);
      this.commentDraft = '';
      await this.notifyMentions(c, extractMentions(body, this.allMembers()));
      if (c.board_id) {
        try {
          await this.activitySvc.log(c.board_id, 'comment.added', { cardId: c.id, memberId });
        } catch {
          /* activity is best-effort */
        }
      }
      await this.reload();
    } catch (e: any) {
      this.toast.error('No se pudo publicar el comentario');
    } finally {
      this.sendingComment.set(false);
    }
  }

  async deleteComment(id: string) {
    try {
      await this.commentsSvc.delete(id);
      await this.reload();
    } catch (e: any) {
      this.toast.error('No se pudo eliminar el comentario');
    }
  }

  // ---------- members ----------
  hasMember(c: Card, memberId: string): boolean {
    return (c.members ?? []).some((m) => m.id === memberId);
  }

  async toggleMember(c: Card, m: Member) {
    try {
      if (this.hasMember(c, m.id)) {
        await this.cardsSvc.removeMember(c.id, m.id);
      } else {
        await this.cardsSvc.addMember(c.id, m.id);
        // Notify the newly-assigned member (service ignores self-notifications).
        await this.notifyAssigned(c, m.id);
      }
      await this.reload();
    } catch (e: any) {
      this.toast.error('No se pudo actualizar los miembros');
    }
  }

  /** Notificaciones 'card.mentioned' para cada miembro mencionado (best-effort;
   *  el servicio ya descarta la auto-mención). */
  private async notifyMentions(c: Card, mentioned: Member[]) {
    for (const m of mentioned) {
      try {
        await this.notificationsSvc.create({
          memberId: m.id,
          actorId: this.currentId(),
          type: 'card.mentioned',
          boardId: c.board_id,
          cardId: c.id,
          data: { title: c.title },
        });
      } catch {
        /* notifications are best-effort */
      }
    }
  }

  /** Fire a 'card.assigned' notification for the given member (best-effort). */
  private async notifyAssigned(c: Card, memberId: string) {
    try {
      await this.notificationsSvc.create({
        memberId,
        actorId: this.currentId(),
        type: 'card.assigned',
        boardId: c.board_id,
        cardId: c.id,
        data: { title: c.title },
      });
    } catch {
      /* notifications are best-effort */
    }
  }

  async assignSelf(c: Card) {
    const id = this.currentId();
    if (!id || this.hasMember(c, id)) return;
    try {
      await this.cardsSvc.addMember(c.id, id);
      // Self-assignment: the service skips the self-notification, but we keep
      // the call for a single, consistent assign path.
      await this.notifyAssigned(c, id);
      await this.reload();
    } catch (e: any) {
      this.toast.error('No se pudo asignarte');
    }
  }

  // ---------- labels ----------
  hasLabel(c: Card, labelId: string): boolean {
    return (c.labels ?? []).some((l) => l.id === labelId);
  }

  async toggleLabel(c: Card, l: Label) {
    try {
      if (this.hasLabel(c, l.id)) {
        await this.labelsSvc.removeFromCard(c.id, l.id);
      } else {
        await this.labelsSvc.addToCard(c.id, l.id);
      }
      await this.reload();
    } catch (e: any) {
      this.toast.error('No se pudo actualizar las etiquetas');
    }
  }

  async createLabel(c: Card) {
    const boardId = c.board_id;
    if (!boardId) return;
    try {
      const label = await this.labelsSvc.create(boardId, this.newLabelName.trim(), this.newLabelColor);
      await this.labelsSvc.addToCard(c.id, label.id);
      this.newLabelName = '';
      await this.reload();
    } catch (e: any) {
      this.toast.error('No se pudo crear la etiqueta');
    }
  }

  // ---------- due date ----------
  dueClasses(c: Card): string {
    if (c.due_complete) return 'bg-emerald-100 text-emerald-700';
    if (this.overdue(c)) return 'bg-red-100 text-red-700';
    if (isDueSoon(c.due_date, c.due_complete)) return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-700';
  }

  overdue(c: Card): boolean {
    return isOverdue(c.due_date, c.due_complete);
  }

  async saveDue(c: Card, pop: PopoverComponent) {
    const due_date = fromDateTimeLocal(this.dueDraft);
    try {
      await this.cardsSvc.update(c.id, { due_date });
      this.card.update((x) => (x ? { ...x, due_date } : x));
      this.store.patchCard(c.id, { due_date });
      pop.close();
    } catch (e: any) {
      this.toast.error('No se pudo guardar la fecha');
    }
  }

  async clearDue(c: Card, pop: PopoverComponent) {
    try {
      await this.cardsSvc.update(c.id, { due_date: null, due_complete: false });
      this.card.update((x) => (x ? { ...x, due_date: null, due_complete: false } : x));
      this.store.patchCard(c.id, { due_date: null, due_complete: false });
      this.dueDraft = '';
      pop.close();
    } catch (e: any) {
      this.toast.error('No se pudo quitar la fecha');
    }
  }

  async toggleDueComplete(c: Card, ev: Event) {
    const due_complete = (ev.target as HTMLInputElement).checked;
    try {
      await this.cardsSvc.update(c.id, { due_complete });
      this.card.update((x) => (x ? { ...x, due_complete } : x));
      this.store.patchCard(c.id, { due_complete });
    } catch (e: any) {
      this.toast.error('No se pudo actualizar el estado');
    }
  }

  // ---------- cover ----------
  async setCover(c: Card, color: string | null, pop: PopoverComponent) {
    try {
      await this.cardsSvc.update(c.id, { cover_color: color });
      this.card.update((x) => (x ? { ...x, cover_color: color } : x));
      this.store.patchCard(c.id, { cover_color: color });
      pop.close();
    } catch (e: any) {
      this.toast.error('No se pudo actualizar la cubierta');
    }
  }

  async setCoverSize(c: Card, size: CardCoverSize) {
    if ((c.cover_size ?? 'strip') === size) return;
    try {
      await this.cardsSvc.update(c.id, { cover_size: size });
      this.card.update((x) => (x ? { ...x, cover_size: size } : x));
      this.store.patchCard(c.id, { cover_size: size });
    } catch (e: any) {
      this.toast.error('No se pudo actualizar la cubierta');
    }
  }

  // ---------- General (rich content) ----------
  private seedRichState(card: Card) {
    const html = card.body_html ?? '';
    this.bodyHtmlSeed.set(html);
    this.bodyEmpty.set(!this.htmlHasContent(html));
    this.progressDraft.set(card.progress ?? 0);
    this.attachments.set(card.attachments ?? []);
  }

  /** True when the HTML actually renders something (ignores empty tags/whitespace). */
  private htmlHasContent(html: string): boolean {
    if (!html) return false;
    const text = html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    return text.length > 0 || /<img|<video|<a\b/i.test(html);
  }

  /** Hide/show the placeholder while typing (bodyEmpty otherwise only
   *  updates on load/blur/paste, leaving the placeholder over the text). */
  onRichInput(el: HTMLElement) {
    this.bodyEmpty.set(!this.htmlHasContent(el.innerHTML));
  }

  /** Persist the editor's HTML on blur. */
  async saveBodyHtml(c: Card, el: HTMLElement) {
    const body_html = el.innerHTML;
    this.bodyEmpty.set(!this.htmlHasContent(body_html));
    if (body_html === (c.body_html ?? '')) return;
    // Menciones sobre el texto plano; solo las nuevas respecto al HTML previo.
    const mentioned = newMentions(htmlToText(c.body_html), htmlToText(body_html), this.allMembers());
    try {
      await this.cardsSvc.update(c.id, { body_html });
      this.card.update((x) => (x ? { ...x, body_html } : x));
      this.store.patchCard(c.id, { body_html });
      // Keep the seed in sync so a later reseed shows the saved value.
      this.bodyHtmlSeed.set(body_html);
      await this.notifyMentions(c, mentioned);
    } catch (e: any) {
      this.toast.error('No se pudo guardar el contenido');
    }
  }

  /**
   * Paste handler: if the clipboard carries an image, intercept it, upload to
   * Storage and insert an <img> at the caret. Plain text/HTML pastes fall
   * through to the browser's default behaviour.
   */
  async onRichPaste(ev: ClipboardEvent, el: HTMLElement) {
    const items = ev.clipboardData?.items;
    if (!items) return;
    let imageItem: DataTransferItem | null = null;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        imageItem = it;
        break;
      }
    }
    if (!imageItem) return; // let text paste happen normally

    ev.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;

    this.uploadingPaste.set(true);
    try {
      const url = await this.storageSvc.upload(file);
      const html = `<img src="${url}" style="max-width:100%;border-radius:8px" />`;
      this.insertHtmlAtCaret(el, html);
      this.bodyEmpty.set(false);
      // Persist immediately so the pasted image survives without a manual blur.
      const c = this.card();
      if (c) await this.saveBodyHtml(c, el);
    } catch (e: any) {
      this.toast.error('No se pudo subir la imagen pegada');
    } finally {
      this.uploadingPaste.set(false);
    }
  }

  /** Insert HTML at the current selection inside `el` (with a safe fallback). */
  private insertHtmlAtCaret(el: HTMLElement, html: string) {
    el.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      if (document.execCommand) {
        document.execCommand('insertHTML', false, html);
        return;
      }
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const tpl = document.createElement('template');
      tpl.innerHTML = html;
      const node = tpl.content.firstChild;
      if (node) {
        range.insertNode(node);
        range.setStartAfter(node);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    } else {
      el.insertAdjacentHTML('beforeend', html);
    }
  }

  // ---------- progress ----------
  progressValue(c: Card): number {
    return c.progress ?? 0;
  }

  onProgressInput(ev: Event) {
    this.progressDraft.set(Number((ev.target as HTMLInputElement).value));
  }

  async saveProgress(c: Card, ev: Event) {
    const progress = Number((ev.target as HTMLInputElement).value);
    this.progressDraft.set(progress);
    try {
      await this.cardsSvc.update(c.id, { progress });
      this.card.update((x) => (x ? { ...x, progress } : x));
      this.store.patchCard(c.id, { progress });
    } catch (e: any) {
      this.toast.error('No se pudo guardar el progreso');
    }
  }

  // ---------- attachments ----------
  private async refreshAttachments(cardId: string) {
    try {
      this.attachments.set(await this.attachmentsSvc.listByCard(cardId));
    } catch {
      /* ignore */
    }
  }

  async onFilesSelected(c: Card, ev: Event, input: HTMLInputElement) {
    const files = Array.from(input.files ?? []);
    input.value = ''; // allow re-selecting the same file
    if (!files.length) return;
    this.uploadingFile.set(true);
    try {
      for (const file of files) {
        const url = await this.storageSvc.upload(file);
        const type: AttachmentType = file.type.startsWith('video/') ? 'video' : 'image';
        await this.attachmentsSvc.add(c.id, file.name, url, type);
      }
      await this.refreshAttachments(c.id);
      this.toast.success(files.length > 1 ? 'Archivos subidos' : 'Archivo subido');
    } catch (e: any) {
      this.toast.error('No se pudieron subir los archivos');
    } finally {
      this.uploadingFile.set(false);
    }
  }

  async addLink(c: Card, pop: PopoverComponent) {
    const url = this.linkUrl.trim();
    if (!url) {
      this.toast.error('Introduce una URL');
      return;
    }
    const name = this.linkName.trim() || url;
    try {
      await this.attachmentsSvc.add(c.id, name, url, 'link');
      this.linkName = '';
      this.linkUrl = '';
      await this.refreshAttachments(c.id);
      pop.close();
    } catch (e: any) {
      this.toast.error('No se pudo añadir el enlace');
    }
  }

  async deleteAttachment(a: Attachment) {
    const c = this.card();
    if (!c) return;
    try {
      await this.attachmentsSvc.delete(a.id);
      await this.refreshAttachments(c.id);
    } catch (e: any) {
      this.toast.error('No se pudo eliminar el adjunto');
    }
  }

  // ---------- move to board ----------
  async openMove() {
    if (this.moveBoards().length) return; // already loaded
    this.loadingMove.set(true);
    try {
      this.moveBoards.set(await this.boardsSvc.list());
    } catch (e: any) {
      this.toast.error('No se pudieron cargar los tableros');
    } finally {
      this.loadingMove.set(false);
    }
  }

  async selectMoveBoard(b: Board) {
    this.moveBoard.set(b);
    this.moveLists.set([]);
    this.loadingMoveLists.set(true);
    try {
      this.moveLists.set(await this.listsSvc.listByBoard(b.id));
    } catch (e: any) {
      this.toast.error('No se pudieron cargar las listas');
    } finally {
      this.loadingMoveLists.set(false);
    }
  }

  async doMove(c: Card, list: List, pop: PopoverComponent) {
    const dest = this.moveBoard();
    if (!dest) return;
    this.moving.set(true);
    try {
      await this.cardsSvc.moveToBoard(c.id, dest.id, list.id, Date.now());
      this.store.removeCardLocal(c.id);
      pop.close();
      this.toast.success(`Tarjeta movida a "${dest.title}"`);
      this.router.navigate(['/board', dest.id]);
    } catch (e: any) {
      this.toast.error('No se pudo mover la tarjeta');
    } finally {
      this.moving.set(false);
    }
  }

  // ---------- archive / delete ----------
  async archive(c: Card) {
    try {
      await this.cardsSvc.setArchived(c.id, true);
      this.store.removeCardLocal(c.id);
      this.toast.success('Tarjeta archivada');
      this.close();
    } catch (e: any) {
      this.toast.error('No se pudo archivar la tarjeta');
    }
  }

  async remove(c: Card) {
    if (!confirm('¿Eliminar esta tarjeta de forma permanente?')) return;
    try {
      await this.cardsSvc.delete(c.id);
      this.store.removeCardLocal(c.id);
      this.toast.success('Tarjeta eliminada');
      this.close();
    } catch (e: any) {
      this.toast.error('No se pudo eliminar la tarjeta');
    }
  }
}

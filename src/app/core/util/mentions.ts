import { Member } from '../models/models';

/** Lowercase + sin acentos, para comparar nombres de forma tolerante. */
export function normalizeForMention(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Miembros cuyo nombre aparece como '@Nombre' en el texto. El nombre debe
 * terminar en un límite de palabra ('@Elio' no matchea al miembro 'Eliot',
 * pero '@Elio,' o '@Elio ' sí matchean a 'Elio').
 */
export function extractMentions(
  text: string | null | undefined,
  members: readonly Member[],
): Member[] {
  if (!text) return [];
  const norm = normalizeForMention(text);
  return members.filter((m) => {
    if (!m.name) return false;
    const token = '@' + normalizeForMention(m.name);
    let i = norm.indexOf(token);
    while (i !== -1) {
      const after = norm.charAt(i + token.length);
      if (!after || !/[\p{L}\p{N}]/u.test(after)) return true;
      i = norm.indexOf(token, i + 1);
    }
    return false;
  });
}

/** Menciones presentes en `next` que no estaban en `prev` (para no re-notificar al editar). */
export function newMentions(
  prev: string | null | undefined,
  next: string | null | undefined,
  members: readonly Member[],
): Member[] {
  const before = new Set(extractMentions(prev, members).map((m) => m.id));
  return extractMentions(next, members).filter((m) => !before.has(m.id));
}

/** Texto plano de un fragmento HTML (para buscar menciones en contenido enriquecido). */
export function htmlToText(html: string | null | undefined): string {
  return (html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
}

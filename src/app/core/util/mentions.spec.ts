import { Member } from '../models/models';
import { extractMentions, htmlToText, newMentions } from './mentions';

const member = (id: string, name: string): Member => ({ id, name, color: '#000' }) as Member;

const ROSTER = [
  member('1', 'Elio Laurencio'),
  member('2', 'Elio'),
  member('3', 'vicented'),
  member('4', 'Soledad Cañete'),
];

describe('extractMentions', () => {
  it('encuentra una mención por nombre completo', () => {
    const found = extractMentions('hola @Elio Laurencio revisa esto', ROSTER);
    expect(found.map((m) => m.id)).toContain('1');
  });

  it('respeta el límite de palabra (no matchea prefijos de otro nombre)', () => {
    const found = extractMentions('@vicentedos no existe', ROSTER);
    expect(found.map((m) => m.id)).not.toContain('3');
  });

  it('matchea al final del texto y antes de puntuación', () => {
    expect(extractMentions('ping @vicented', ROSTER).map((m) => m.id)).toContain('3');
    expect(extractMentions('ping @vicented, gracias', ROSTER).map((m) => m.id)).toContain('3');
  });

  it('es insensible a mayúsculas y acentos', () => {
    const found = extractMentions('cc @soledad canete', ROSTER);
    expect(found.map((m) => m.id)).toContain('4');
  });

  it('devuelve vacío sin texto o sin @', () => {
    expect(extractMentions(null, ROSTER)).toEqual([]);
    expect(extractMentions('sin menciones aquí', ROSTER)).toEqual([]);
  });
});

describe('newMentions', () => {
  it('solo devuelve menciones que no estaban en el texto anterior', () => {
    const prev = 'ya mencioné a @vicented';
    const next = 'ya mencioné a @vicented y ahora a @Elio Laurencio';
    const found = newMentions(prev, next, ROSTER);
    expect(found.map((m) => m.id)).toEqual(['1', '2']);
  });

  it('sin texto anterior, todas las menciones son nuevas', () => {
    expect(newMentions(null, 'hola @vicented', ROSTER).map((m) => m.id)).toEqual(['3']);
  });
});

describe('htmlToText', () => {
  it('quita etiquetas y nbsp para poder escanear menciones', () => {
    expect(htmlToText('<p>hola&nbsp;<b>@vicented</b></p>')).toContain(' @vicented ');
    expect(htmlToText(null)).toBe('');
  });
});

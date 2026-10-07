import { describe, expect, it } from 'vitest';
import { keywordState, toggleKeyword } from './keywords';

const base = { required_any: ['typescript', 'node.js'], boost: ['postgres'], exclude: ['php'] };

describe('keyword delle preferenze da una tecnologia', () => {
  it('riconosce la tecnologia anche tramite alias', () => {
    expect(keywordState(base, 'PostgreSQL')).toEqual({ boost: true, required_any: false, exclude: false });
    expect(keywordState(base, 'Node.js')).toEqual({ boost: false, required_any: true, exclude: false });
    expect(keywordState(base, 'Kafka')).toEqual({ boost: false, required_any: false, exclude: false });
  });

  it('aggiunge in minuscolo e non tocca gli altri elenchi', () => {
    expect(toggleKeyword(base, 'NestJS', 'boost')).toEqual({ ...base, boost: ['postgres', 'nestjs'] });
    expect(toggleKeyword(base, 'React', 'required_any').required_any).toEqual(['typescript', 'node.js', 'react']);
  });

  it('se c’è già la toglie, anche se salvata come alias', () => {
    expect(toggleKeyword(base, 'PostgreSQL', 'boost').boost).toEqual([]);
    expect(toggleKeyword(base, 'PHP', 'exclude').exclude).toEqual([]);
  });

  it('escludere toglie da preferite e richieste, e viceversa', () => {
    expect(toggleKeyword(base, 'PostgreSQL', 'exclude')).toEqual({
      ...base,
      boost: [],
      exclude: ['php', 'postgresql'],
    });
    expect(toggleKeyword(base, 'Node.js', 'exclude').required_any).toEqual(['typescript']);
    expect(toggleKeyword(base, 'PHP', 'boost')).toEqual({ ...base, boost: ['postgres', 'php'], exclude: [] });
  });
});

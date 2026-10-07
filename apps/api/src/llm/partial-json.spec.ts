import { partialJsonString } from './partial-json';

describe('partialJsonString', () => {
  it('legge il valore mentre arriva', () => {
    expect(partialJsonString('{"action": "next", "sa', 'say')).toBe('');
    expect(partialJsonString('{"action": "next", "say": "Va bene. Proce', 'say')).toBe('Va bene. Proce');
    expect(partialJsonString('{"action":"next","say":"Va bene."}', 'say')).toBe('Va bene.');
  });

  it('decodifica gli escape e aspetta quelli incompleti', () => {
    expect(partialJsonString('{"say": "Ha detto \\"sì\\"?\\nBene', 'say')).toBe('Ha detto "sì"?\nBene');
    expect(partialJsonString('{"say": "perch\\u00e9', 'say')).toBe('perché');
    expect(partialJsonString('{"say": "perch\\u00', 'say')).toBe('perch');
    expect(partialJsonString('{"say": "fine\\', 'say')).toBe('fine');
  });
});

import { isPhantomTranscript, spokenText } from './transcript-filter';

const HINT = 'Staff back-end Engineer TypeScript Node.js H/F (CNA-0370), Node.js, TypeScript, AWS, Kubernetes, Kafka';

describe('isPhantomTranscript', () => {
  it('scarta l’eco del suggerimento', () => {
    expect(isPhantomTranscript('CNA-0370.', HINT)).toBe(true);
    expect(isPhantomTranscript('Node.js, TypeScript, AWS', HINT)).toBe(true);
    expect(isPhantomTranscript('')).toBe(true);
  });

  it('scarta le frasi inventate sul silenzio', () => {
    expect(isPhantomTranscript('Sottotitoli creati dalla comunità Amara.org')).toBe(true);
    expect(isPhantomTranscript('Thanks for watching!')).toBe(true);
  });

  it('tiene le risposte vere, anche brevi o piene di termini del suggerimento', () => {
    expect(isPhantomTranscript('Sì, può ripetere la domanda?', HINT)).toBe(false);
    expect(isPhantomTranscript('Ho usato Kafka con Node.js per i pagamenti', HINT)).toBe(false);
    expect(isPhantomTranscript('Kafka e poi Kubernetes', HINT)).toBe(false);
  });
});

describe('spokenText', () => {
  it('toglie i pezzi senza voce', () => {
    expect(
      spokenText([
        { text: ' Buongiorno a tutti.', avg_logprob: -0.2, no_speech_prob: 0.01 },
        { text: ' Grazie.', avg_logprob: -1.4, no_speech_prob: 0.9 },
        { text: ' Comincio io.', avg_logprob: -0.3, no_speech_prob: 0.7 },
      ]),
    ).toBe('Buongiorno a tutti. Comincio io.');
  });
});

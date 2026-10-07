let context: AudioContext | null = null;

/**
 * Breve segnale acustico della conversazione: due note che salgono quando tocca a te ("listen"),
 * due che scendono quando la risposta è stata presa ("done"). Così non serve guardare lo schermo.
 */
export function playCue(kind: 'listen' | 'done'): void {
  if (typeof AudioContext === 'undefined') return;
  try {
    context ??= new AudioContext();
    void context.resume();
    const [first, second] = kind === 'listen' ? [660, 880] : [660, 440];
    const start = context.currentTime + 0.01;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(first, start);
    oscillator.frequency.setValueAtTime(second, start + 0.08);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
    gain.gain.setValueAtTime(0.12, start + 0.13);
    gain.gain.linearRampToValueAtTime(0, start + 0.16);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.17);
  } catch {
    // il segnale è un di più: se l'audio non parte la conversazione continua
  }
}

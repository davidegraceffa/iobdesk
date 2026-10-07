#!/bin/sh
# Scarica le voci richieste (solo se mancano) e avvia il server HTTP di Piper: la prima voce è quella predefinita.
set -e
DATA_DIR="${PIPER_DATA_DIR:-/data/piper}"
mkdir -p "$DATA_DIR"
DEFAULT_VOICE=""
for voice in $(echo "${PIPER_VOICES:-it_IT-paola-medium}" | tr ',' ' '); do
  if [ ! -f "$DATA_DIR/$voice.onnx" ] || [ ! -f "$DATA_DIR/$voice.onnx.json" ]; then
    echo "Scarico la voce $voice…"
    python3 -m piper.download_voices "$voice" --data-dir "$DATA_DIR" || echo "Voce $voice non scaricata"
  fi
  if [ -z "$DEFAULT_VOICE" ] && [ -f "$DATA_DIR/$voice.onnx" ]; then DEFAULT_VOICE="$voice"; fi
done
if [ -z "$DEFAULT_VOICE" ]; then
  echo "Nessuna voce disponibile: controlla PIPER_VOICES e la connessione" >&2
  exit 1
fi
# pausa tra le frasi: 0.2 s dà un numero pari di byte a 16000 e 22050 Hz; con un numero dispari (es. 0.25 s a
# 22050 Hz) Piper sfasa i campioni a 16 bit e tutto ciò che segue la prima frase diventa rumore bianco
exec python3 -m piper.http_server -m "$DEFAULT_VOICE" --data-dir "$DATA_DIR" --sentence-silence 0.2 --host 0.0.0.0 --port 5000

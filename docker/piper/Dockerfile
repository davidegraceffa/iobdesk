# Sintesi vocale neurale in locale (Piper) per la voce dell'intervistatore nei colloqui simulati.
ARG PYTHON_IMAGE=python:3.12-slim
FROM ${PYTHON_IMAGE}
RUN pip install --no-cache-dir "piper-tts[http]==1.3.0"
COPY docker/piper/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 5000
ENTRYPOINT ["/entrypoint.sh"]

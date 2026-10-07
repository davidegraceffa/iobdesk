# Iobdesk

Iobdesk è la scrivania da cui gestire la ricerca di lavoro, in locale sul tuo computer. Raccoglie gli annunci da
più fonti, li filtra e li ordina in base al tuo profilo, tiene lo storico delle candidature e ti aiuta a
prepararle: CV e lettere su misura a partire dai tuoi documenti, colloqui simulati, revisione periodica dei CV.

Gira interamente in Docker ed è pubblicata solo su `127.0.0.1`. Non servono account né servizi a pagamento: le
funzioni che usano un modello linguistico sono facoltative e possono girare con un modello locale.

## Cosa fa

**Annunci**

- Raccolta automatica da Remotive, Remote OK, Arbeitnow, Himalayas, Jobicy, We Work Remotely e dal thread
  "Who is hiring?" di Hacker News, più gli alert via email di LinkedIn, Indeed e Glassdoor se li inoltri a una
  cartella dedicata.
- Normalizzazione, deduplicazione tra fonti ed estrazione dello stack tecnologico.
- Filtri e punteggio da 0 a 100 costruiti sul tuo profilo: paese e fuso orario, partita IVA, keyword richieste,
  preferite ed escluse, seniority, contratto, retribuzione minima, aziende bloccate. Ogni annuncio scartato riporta
  il motivo.
- Retribuzione come scritta nell'annuncio, convertita nella tua valuta; se manca, una stima su richiesta, sempre
  indicata come tale.

**Candidature**

- Storico in tabella o kanban, con timeline degli stati, promemoria di follow-up ed export CSV.
- Import da un foglio di calcolo e aggiornamento automatico dalle email di Gmail (conferme e rifiuti), in sola
  lettura.

**Documenti**

- CV su misura per un annuncio a partire dal tuo CV in DOCX, mantenendo impaginazione e stile: ogni modifica è
  mostrata con prima e dopo e si può accettare, rifiutare o ritoccare. Il sistema non inventa: può usare solo ciò
  che è nel tuo CV o che hai dichiarato tu.
- CV da una descrizione incollata a mano, lettera di candidatura ed email di accompagnamento.
- Revisione periodica dei CV base con proposte che l'app applica generando una nuova versione del documento, e
  valutazione di compatibilità con i sistemi ATS.

**Colloqui**

- Colloqui simulati su un annuncio o su una candidatura passata, a voce o per iscritto, con domande da colloquio
  reale, piccoli aiuti quando ti blocchi e una valutazione finale su contenuti e tono.

## Come è fatto

| Servizio    | Cosa fa                                                              | Porte sull'host         |
| ----------- | -------------------------------------------------------------------- | ----------------------- |
| `web`       | nginx: serve l'interfaccia e fa da reverse proxy di `/api`           | `127.0.0.1:${APP_PORT}` |
| `api`       | NestJS: raccolta, filtri, API, code di lavoro, generazione dei CV    | nessuna                 |
| `db`        | PostgreSQL 16                                                        | nessuna                 |
| `gotenberg` | conversione DOCX in PDF per anteprime e download                     | nessuna                 |
| `ollama`    | modello linguistico locale (facoltativo, profilo `llm`)              | nessuna                 |
| `whisper`   | trascrizione locale delle risposte a voce (facoltativo, `stt`)       | nessuna                 |
| `piper`     | voce neurale locale dell'intervistatore (facoltativo, profilo `tts`) | nessuna                 |

- **Backend**: NestJS, Prisma, PostgreSQL 16 (`pg_trgm`, ricerca full-text), code pg-boss.
- **Frontend**: React, Vite, Tailwind CSS, shadcn/ui.
- **Privacy**: i dati restano sul tuo computer. Escono solo le richieste verso le fonti degli annunci e, se lo
  attivi tu e dai il consenso, quelle verso un modello linguistico esterno. `db` e `gotenberg` stanno su una rete
  Docker interna senza accesso a Internet.

## Requisiti

- Docker con Compose v2, versione 2.24 o successiva (Docker Desktop su macOS e Windows, Docker Engine su Linux).
- Circa 5 GB di spazio per le immagini; di più se attivi il modello locale o i servizi vocali.
- Un browser recente.

Sul computer non serve installare altro: né Node, né pnpm, né PostgreSQL.

## Avvio rapido

1. Scarica il progetto ed entra nella cartella:

   ```bash
   git clone https://github.com/davidegraceffa/iobdesk.git
   cd iobdesk
   ```

2. Crea il file di configurazione locale. I valori predefiniti vanno bene per iniziare:

   ```bash
   cp .env.example .env
   ```

3. Avvia tutto. Il primo avvio costruisce le immagini e richiede qualche minuto:

   ```bash
   docker compose up -d --build
   ```

4. Apri <http://127.0.0.1:8080>.

Se la porta 8080 è già occupata, cambia `APP_PORT` in `.env` e rilancia `docker compose up -d`.

## Primi passi

1. **Onboarding.** Alla prima apertura l'app chiede paese di residenza, se hai una partita IVA e il fuso orario.
   Finché non salvi non viene raccolto nulla; subito dopo parte la prima raccolta e in circa un minuto la lista si
   popola.
2. **Criteri di ricerca.** In **Profilo** imposta keyword, seniority, contratto e retribuzione minima. Ogni
   salvataggio ricalcola filtri e punteggi di tutti gli annunci.
3. **Annunci.** La pagina si apre sugli annunci nuovi: salvali, scartali o candidati. Dopo la candidatura l'app la
   registra nello storico con una copia dell'annuncio.
4. **CV e modello linguistico (facoltativi).** Per CV su misura, lettere, colloqui e revisione dei CV carica un CV
   in DOCX in **Profilo → CV** e attiva un modello come descritto qui sotto.

La descrizione completa di ogni funzione è nella [guida all'uso](docs/GUIDA.md).

## Attivare un modello linguistico

Il modello è facoltativo e disattivato all'inizio. Serve per: punteggio aggiuntivo degli annunci, CV e lettere su
misura, email di accompagnamento, stima della retribuzione, colloqui simulati, revisione e valutazione ATS dei CV.

**Locale, con Ollama.** I dati non lasciano il computer.

```bash
docker compose --profile llm up -d
docker compose exec ollama ollama pull llama3.1
```

Poi in **Profilo → Avanzate** attiva "Usa un LLM", scegli il provider Ollama e il modello `llama3.1`.

**Esterno, con Claude o OpenAI.**

1. Metti le credenziali in `.env` e rilancia `docker compose up -d`:
   - Claude: `ANTHROPIC_API_KEY` (chiave della Claude Console) oppure `CLAUDE_CODE_OAUTH_TOKEN` (token del tuo
     abbonamento Claude, generato con `claude setup-token`). Se ci sono entrambe vale il token.
   - OpenAI: `OPENAI_API_KEY`.
2. In **Profilo → Avanzate** scegli provider e modello.
3. L'interfaccia avvisa che annunci e CV verranno inviati a un servizio esterno e chiede un consenso esplicito,
   revocabile in ogni momento. Nome e contatti del CV non vengono mai inviati.

## Componenti facoltativi

Tutti si configurano nel file `.env`; dopo ogni modifica rilancia `docker compose up -d`.

| Funzione                         | Cosa serve                                                              | Dove è spiegato                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Risposte a voce nei colloqui     | `docker compose --profile stt up -d` (trascrizione locale con Whisper)  | [Colloqui simulati](docs/GUIDA.md#colloqui-simulati)                                                 |
| Voce neurale dell'intervistatore | `docker compose --profile tts up -d --build` (sintesi locale con Piper) | [Colloqui simulati](docs/GUIDA.md#colloqui-simulati)                                                 |
| Candidature da Gmail             | un client OAuth personale su Google Cloud, in sola lettura              | [Candidature da Gmail](docs/GUIDA.md#candidature-da-gmail)                                           |
| Alert di LinkedIn, Indeed…       | accesso IMAP a una cartella dedicata della tua posta                    | [Import degli alert via email](docs/GUIDA.md#import-degli-alert-via-email-linkedin-indeed-glassdoor) |
| Notifiche Telegram               | un bot personale e il tuo chat id                                       | [Notifiche Telegram](docs/GUIDA.md#notifiche-telegram)                                               |

Per avviare sempre insieme all'app i servizi con un profilo, aggiungi a `.env` una riga come
`COMPOSE_PROFILES=llm,stt,tts`.

## Comandi utili

```bash
docker compose ps                                     # stato dei servizi
docker compose logs -f api                            # log dell'applicazione
docker compose exec api node dist/cli fetch           # raccolta manuale da tutte le fonti
docker compose exec api node dist/cli fetch --source remotive   # una sola fonte
docker compose exec api node dist/cli recompute       # ricalcola filtri e punteggi
docker compose down                                   # ferma tutto, i dati restano
docker compose down -v                                # reset completo: cancella database e documenti
```

Per aggiornare a una versione più recente:

```bash
git pull
docker compose up -d --build
```

Le migrazioni del database vengono applicate da sole all'avvio.

## Dati, backup e ripristino

I dati stanno in volumi Docker: `pgdata` (database), `cvdata` (CV, lettere e documenti generati), `appstate`
(autorizzazione Gmail). Le credenziali restano nel file `.env`, che non va mai condiviso né versionato: non
vengono salvate nel database né mostrate nell'interfaccia.

Backup:

```bash
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > iobdesk-db.sql
docker run --rm -v job-aggregator_cvdata:/data:ro -v "$PWD":/backup postgres:16-alpine \
  tar czf /backup/cvdata-backup.tgz -C /data .
```

Ripristino dei documenti:

```bash
docker run --rm -v job-aggregator_cvdata:/data -v "$PWD":/backup postgres:16-alpine \
  tar xzf /backup/cvdata-backup.tgz -C /data
```

Il prefisso `job-aggregator` nei nomi di volumi e container è il nome del progetto Compose, definito in
`docker-compose.yml`.

## Problemi comuni

- **La pagina non si apre.** Controlla lo stato con `docker compose ps` e i log con `docker compose logs -f api`.
  Al primo avvio l'API impiega fino a un minuto per diventare pronta.
- **Porta già in uso.** Cambia `APP_PORT` in `.env` e rilancia `docker compose up -d`.
- **Nessun annuncio dopo l'onboarding.** La prima raccolta richiede circa un minuto; lo stato di ogni fonte, con
  gli eventuali errori, è nella pagina **Fonti**.
- **Le funzioni con il modello risultano non disponibili.** Il modello va attivato in **Profilo → Avanzate**; con
  un provider esterno servono anche le credenziali in `.env` e il consenso.
- **Il microfono non funziona.** Il browser lo concede solo aprendo l'app da `http://127.0.0.1` o
  `http://localhost`.

## Documentazione

- [Guida all'uso](docs/GUIDA.md): ogni funzione in dettaglio.
- [SOURCES.md](SOURCES.md): le fonti degli annunci e come aggiungerne una.
- [DECISIONS.md](DECISIONS.md): le scelte di progetto e i loro motivi.
- Documentazione OpenAPI dell'API, ad app avviata: <http://127.0.0.1:8080/api/docs>.

## Sviluppo

Modalità con hot reload (sorgenti montati come volume, `nest start --watch`, Vite con HMR):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Per caricarla sempre in automatico aggiungi a `.env` la riga
`COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml`. Dopo aver cambiato le dipendenze ricrea i volumi di
`node_modules` con `up --build -V`.

Lint, formattazione, typecheck e test unitari (senza rete e senza database):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm --build --no-deps api pnpm check
```

Test di integrazione con PostgreSQL e Gotenberg veri, su uno stack usa e getta:

```bash
docker compose -f docker-compose.test.yml run --rm --build tests
docker compose -f docker-compose.test.yml down -v
```

Struttura del repository:

```
apps/api            NestJS: fonti, pipeline, annunci, candidature, posta, CV, colloqui, code, LLM, CLI;
                    schema e migrazioni Prisma
apps/web            React e shadcn/ui, configurazione nginx
packages/shared     schema delle impostazioni, tipi condivisi, geografia, dizionario delle tecnologie,
                    parser delle retribuzioni
config/search.yaml  impostazioni iniziali, lette una sola volta al primo avvio
docs                guida all'uso
tests/fixtures      risposte delle fonti rese anonime e CV di esempio usati dai test
```

## Licenza

[MIT](LICENSE).

# Decisioni

Scelte fatte dove la specifica (`todo.md`) era ambigua o lasciava margine, e dove la realtà (endpoint, versioni
delle librerie) ha imposto un adattamento. Criterio: l'opzione più semplice e robusta.

## Stack e versioni

- **Linee stabili verificate, non le ultime major.** A ottobre 2026 esistono NestJS 12, Prisma 7 (8 in RC),
  TypeScript 7, pg-boss 12, Vite 8, Jest 30, TanStack Table 9. Ho fissato le linee precedenti, ancora mantenute:
  NestJS 11, Prisma 6, TypeScript 5.9, pg-boss 10, Vite 7, Jest 29, TanStack Table 8, perché sono quelle che ho
  potuto far girare e verificare da cima a fondo (build, lint, test, stack completo). L'aggiornamento alle major
  nuove è un lavoro a sé. Fa eccezione ESLint: la 9 è dichiarata non più supportata, quindi uso la 10.
- **Node 24 LTS** (`node:24-bookworm-slim`); pnpm 10 via Corepack, solo dentro i container.
- **`tinyld` al posto di `franc`** per rilevare la lingua: `franc` è solo ESM e complica build e test di NestJS
  (CommonJS); `tinyld` fa lo stesso lavoro.
- **Niente `@tanstack/react-virtual`**: la lista annunci è paginata lato server (30 per pagina), quindi la
  virtualizzazione non serve; ho evitato una dipendenza inutilizzata.
- **Immagine `api` di circa 1 GB non compressa**: base Node, CLI e motori di Prisma (servono a runtime per
  `migrate deploy`), poppler. È multi-stage, senza dipendenze di sviluppo, con utente non root.
- **Dockerfile senza `# syntax=docker/dockerfile:1`**: BuildKit di Docker supporta già ciò che serve
  (`--mount=type=cache`, `COPY --chmod`) e si evita una dipendenza di rete a ogni build.

## Docker

- **`docker-compose.dev.yml` invece di `docker-compose.override.yml`.** Un file `override` verrebbe caricato in
  automatico anche da chi vuole solo usare l'app, facendo partire la modalità sviluppo (sorgenti montati, watch)
  con il comando del README. Così `docker compose up -d --build` avvia sempre la versione di produzione; chi
  sviluppa aggiunge `-f docker-compose.dev.yml` oppure `COMPOSE_FILE=…` in `.env` (documentato).
- **Nessun profilo `dbtools`**: PostgreSQL non è mai esposto sull'host. Per una console SQL basta
  `docker compose exec db psql …`.
- **Due reti**: `backend` è `internal` (db e gotenberg non hanno uscita verso Internet), `frontend` permette
  all'api di raggiungere le fonti. Solo `web` pubblica una porta, legata a `127.0.0.1`.
- **Test di integrazione in un compose separato** (`docker-compose.test.yml`) con PostgreSQL su tmpfs, così non
  toccano mai i dati veri.
- **Nessuna autenticazione**: l'app è raggiungibile solo dal loopback della macchina.

## Impostazioni e LLM

- **Chiavi YAML vuote**: `user:` con le sole righe commentate vale `null` in YAML; viene trattato come assente.
- **`scoring.llm.enabled` è l'interruttore generale dell'LLM** (punteggio LLM e generazione CV). Provider e modello
  restano in `scoring.llm`, come nel formato della specifica. Ho aggiunto `scoring.llm.external_consent`
  (consenso per i provider esterni), `cv.languages`, `cv.extra_skills`, `applications.followup_days` e
  `dedupe.similarity_threshold`.
- **`LLM_PROVIDER` in `.env`**, se valorizzato, forza il provider scelto nelle impostazioni (l'interfaccia lo
  segnala). Il valore `mock` attiva un provider finto, utile per provare il flusso dei CV senza alcun modello.
- **Consenso per i provider esterni**: senza consenso l'LLM esterno non viene usato per nulla (né punteggi né CV).
  Il dialog "Genera CV" lo chiede e lo salva; cambiare provider lo azzera.
- **Claude tramite Agent SDK** (`@anthropic-ai/claude-agent-sdk`) al posto della Messages API: il provider resta
  `anthropic` nelle impostazioni, il modello proposto è `claude-opus-5-5`. L'SDK avvia Claude Code come
  sottoprocesso; qui è usato come completamento a un solo turno: nessuno strumento (`tools: []`), nessuna
  impostazione o `CLAUDE.md` letti dal disco, nessuna sessione salvata, niente traffico accessorio (telemetria,
  aggiornamenti). Al sottoprocesso passano solo `PATH`, `HOME` e le credenziali Claude, non gli altri segreti
  dell'app. Si autentica con `CLAUDE_CODE_OAUTH_TOKEN` (abbonamento Claude) oppure, se manca, con `ANTHROPIC_API_KEY`.
  Rispetto a prima si perde il fallback lato server in caso di rifiuto, e l'immagine dell'API cresce di circa
  400 MB (binario di Claude Code).
- **OpenAI e Ollama via HTTP diretto**, senza SDK aggiuntivi. Le risposte sono sempre JSON validato con Zod, con un
  secondo tentativo se non valido.
- **Messaggi di validazione in italiano** tramite la localizzazione di Zod, uguali nel form e nell'API.

## Fonti

- **Remotive** oggi restituisce 16 annunci di tutte le categorie e ignora i parametri: l'adapter prende ciò che
  arriva e lascia filtrare la pipeline. Intervallo minimo 6 ore, come chiede la fonte.
- **Ogni adapter dichiara un intervallo minimo**; l'intervallo effettivo è il maggiore tra quello e il valore nel
  Profilo. Le raccolte manuali ravvicinate (meno di 5 minuti) riusano i dati salvati, salvo `--force`.
- **Hacker News**: si usa l'ultimo thread "Who is hiring?" disponibile; i commenti che non seguono la convenzione
  `Azienda | Ruolo | …` non sono annunci e vengono ignorati.
- **Himalayas**: ricerca per keyword del profilo invece del feed completo (100.000 annunci a 20 per pagina).
- **Remote OK e Jobicy** chiedono che la candidatura passi dalla loro pagina: "Candidati" porta lì anche se nella
  descrizione c'è un link diretto.
- **Remote OK**: `salary_min`/`salary_max` sono trattati come campi della fonte; se la fonte un giorno li
  valorizzasse con stime, l'adapter andrebbe adattato.
- **Arbeitnow**: `remote: false` è un'indicazione esplicita, quindi l'annuncio non è mai "full remote".
- **Fixture delle fonti anonime**: i file in `tests/fixtures/sources` nascono da risposte vere (per avere la
  struttura esatta), ma aziende, link, email, autori e identificativi sono stati sostituiti con valori fittizi e le
  descrizioni accorciate: nel repository non ci sono annunci riconducibili a terzi. I commenti di Hacker News di chi
  cerca lavoro sono stati rimpiazzati da un testo neutro.
- **Alert via email**: i template reali non erano disponibili; il parser è euristico e testato su email costruite.

## Pipeline

- **Aziende bloccate**: sono un filtro rigido come le keyword escluse (`companies.blocked` nelle impostazioni),
  quindi valgono per annunci presenti e futuri e passano dal normale ricalcolo; l'annuncio resta nel database con
  il motivo "Azienda bloccata". Il confronto è sul nome intero normalizzato (stessa normalizzazione della
  deduplicazione), non per sottostringa: bloccare "Meta" non deve nascondere "Metabase".
- **Vincolo geografico**: il campo strutturato della fonte vince se indica paesi o aree precise; altrimenti si
  cercano frasi esplicite nel testo ("US only", "must reside in…", "Remote (US)"). Le sigle di 2-3 lettere (US,
  UK, EU) valgono solo in maiuscolo, per non confonderle con parole comuni. Un annuncio senza vincoli riconosciuti
  resta visibile.
- **Fuso orario**: si considerano solo le frasi che parlano di orari o overlap; le sigle a due lettere ambigue
  (PT, MT, CT) non vengono interpretate.
- **Keyword escluse e richieste**: cercate in titolo, tag, descrizione e stack (parola intera; le tecnologie
  riconoscono gli alias).
- **Retribuzione**: mai stimata. Senza periodo esplicito un importo vale come annuo solo se ≥ 10.000; cifre di
  funding, fatturato e bonus vengono saltate. Le soglie minime si confrontano con l'estremo alto dell'intervallo;
  senza tasso di cambio configurato l'importo resta nella valuta originale e non viene filtrato. I tassi di esempio
  sono verso l'euro: cambiando paese vanno aggiornati a mano.
- **Deduplicazione**: stesso URL canonico di candidatura (solo per link ad ATS, con titolo simile) oppure azienda
  e titolo normalizzati simili oltre soglia (`pg_trgm`, default 0,8). Resta principale l'annuncio più completo, a
  meno che l'utente abbia già lavorato sull'altro. Annunci identici che differiscono solo per città risultano
  duplicati. Cambiare la soglia vale per le raccolte successive.
- **Penalità "tecnologie non preferite"**: le tecnologie dello stack che non sono tra le tue keyword (preferite o
  richieste) tolgono fino a 25 punti: `25 × quota estranea dello stack × min(1, estranee / 6)`, nulla se è una
  sola. Esempi: 6 su 14 → −11, 4 su 8 → −8, 5 su 7 → −15, 15 su 22 → −17. La voce compare nella scomposizione del
  punteggio con l'elenco delle tecnologie; aggiungerle alle preferite dal dettaglio dell'annuncio riduce la
  penalità. La prima versione (soglia al 40%, massimo −15) toglieva 1-2 punti a quasi tutti: troppo poco.
- **Punteggio a regole (0-100)**: keyword richieste 25, preferite 15, area geografica 15, seniority 10, contratto
  10, retribuzione 10, fuso 5, P.IVA 5, freschezza 5. Con policy `penalize`, un ruolo che richiede la P.IVA che
  non hai perde 20 punti.
- **Nota fiscale UE**: mostrata sui ruoli contract/B2B quando l'utente è in un paese UE e ha la P.IVA; il paese
  del cliente non è ricavabile in modo affidabile dall'annuncio. Nessun'altra logica fiscale.
- **Dizionario tecnologie**: i nomi ambigui (Go, Swift, Rust, Express, React…) richiedono maiuscola o contesto
  tecnico. Restano possibili falsi positivi quando un annuncio cita un'azienda che si chiama come una tecnologia
  (es. clienti "Shopify" o "Snowflake").
- **Ricerca full-text** con configurazione `english` (la maggior parte degli annunci è in inglese), più
  similarità su titolo e azienda.

## Import delle candidature

- **Campi aggiunti alle candidature** per accogliere il foglio di tracciamento: `externalId` (l'"ID offerta", univoco,
  usato per riconoscere le righe già importate), `country` (Nazione), `cvSent` e `cvLanguage` (CV inviato e lingua),
  `trackingMode` (Modalità, es. "Da email"). Portale, località, posizione, azienda e link vanno nei campi che
  esistevano già (snapshot dell'annuncio).
- **Nuovo stato "Saltata"** per le candidature non completate (es. il portale chiedeva un account): restano nello
  storico ma non contano nei totali né nel tasso di risposta. **Nuovo canale "Portale di annunci"** (Indeed e simili).
- **Timeline delle importate**: primo evento alla data di candidatura; il rifiuto o il colloquio hanno la data
  indicata nelle note quando c'è (es. "rifiuto: … (2026-09-01)"), altrimenti la data di candidatura con la dicitura
  "data del cambio non indicata nel file".
- **Reimport**: lo stato viene aggiornato dal file; note, contatto, nazione e CV si riempiono solo se vuoti.
  Azienda o posizione mancanti diventano "Azienda non indicata" / "Posizione non indicata", non vengono inventate.
- **Il foglio Google non viene letto direttamente dall'app**: è privato e servirebbe un accesso al tuo account;
  l'import passa da un file CSV scaricato.

## Candidature da Gmail

Porta dentro l'app quello che faceva `jc mail` di job-compiler, con il database al posto del foglio Google.

- **Stesse regole di job-compiler**: il riconoscimento delle email (`apps/api/src/mail/parse.ts`, `country.ts`) è
  copiato così com'è, con i suoi test. Stesse ricerche Gmail, stesse frasi, stesso abbinamento dei rifiuti.
- **Compatibilità con le righe importate dal foglio**: la chiave resta `mail-<threadId>` (campo `externalId`), la
  modalità "Da email", le note `da mail: <oggetto>` e il marcatore `rifiuto: mail-<threadId> (data)`. Le righe
  già importate vengono quindi riconosciute e non duplicate, e i rifiuti già applicati non vengono riapplicati.
- **Solo lettura, solo Gmail**: lo scope richiesto è `gmail.readonly`. Quello dei fogli Google non serve più.
- **Nessuna nuova dipendenza**: tre chiamate REST (`token`, `messages.list`, `messages.get`) fatte con `fetch`,
  invece di `googleapis` + `google-auth-library`.
- **Collegamento dall'interfaccia, non da terminale**: nel container non c'è un browser, quindi il flusso OAuth
  "app desktop" (PKCE, ritorno su loopback) termina su `/api/mail/oauth/callback` dell'app stessa. Il ritorno usa
  `127.0.0.1` e la porta di `APP_PORT`.
- **Dove stanno i segreti**: client OAuth in `.env`; refresh token in un file (permessi 600) nel volume `appstate`,
  mai nel database né nelle risposte dell'API. L'interfaccia mostra solo l'indirizzo della casella collegata.
- **Scritture automatiche senza conferma** nella sincronizzazione periodica (job-compiler chiedeva conferma, salvo
  `--yes`). L'aggiornamento manuale mostra prima l'anteprima. I rifiuti ambigui non vengono mai applicati.
- **Solo conferme e rifiuti**, come in job-compiler: gli inviti a colloquio non cambiano lo stato (le frasi sono
  troppo varie per farlo senza errori); si aggiornano a mano.
- **Date**: la data della candidatura è il giorno della mail nel tuo fuso (Profilo), salvata a mezzogiorno UTC come
  per le righe importate; l'evento di rifiuto ha l'ora reale della mail.
- **Candidature "Saltate"**: non vengono mai abbinate a una mail (non sono state inviate).
- **Storico delle esecuzioni** in una tabella dedicata (`MailSyncRun`, ultime 100): serve a mostrare esito, novità
  e rifiuti ambigui anche per le sincronizzazioni avvenute in background.
- **Autorizzazione scaduta**: se Google rifiuta il refresh token la sincronizzazione si ferma (un solo errore
  registrato, niente tentativi a vuoto) e l'interfaccia chiede di ricollegare Gmail.

## Stima della RAL

- **Solo su richiesta e sempre etichettata**: la regola resta che l'app non mostra retribuzioni che l'annuncio non
  indica. La stima nasce solo dal tasto "Genera RAL", è salvata in un campo a parte (`Job.salaryEstimate`), ha uno
  stile diverso dalla RAL dichiarata e non entra in filtri, punteggi, export o snapshot delle candidature. Se una
  raccolta successiva trova la retribuzione nell'annuncio, la stima smette di essere mostrata.
- **Area geografica**: al modello vanno località, regioni e paesi ammessi dell'annuncio, non il paese
  dell'utente; la valuta è quella del mercato stimato, convertita in locale con i tassi statici del Profilo.
- **Sempre lorda annua**, anche per contratti freelance: un solo formato confrontabile, la tariffa giornaliera
  resterebbe un'altra stima sopra la stima.
- **Chiamata diretta, senza coda**: una sola richiesta all'LLM avviata dall'utente, che aspetta il risultato.
  All'LLM va solo l'annuncio, nessun dato personale.

## CV su misura

- **Id dei paragrafi** = posizione nel documento (`p0`, `p1`, …): stabili per lo stesso file; le modifiche si
  applicano sempre ripartendo dal DOCX base, che non viene mai toccato.
- **Cosa si può modificare**: sommario e competenze per intero, delle esperienze solo i bullet. Dati personali,
  righe di ruolo/azienda/date, formazione, lingue e intestazioni sono immutabili. L'utente può correggere le
  sezioni riconosciute.
- **Paragrafi con stili misti** (es. un grassetto a metà frase), link, campi o immagini non sono sostituibili: la
  modifica viene scartata con il motivo. I run di soli spazi e le proprietà senza effetto visivo (lingua, rsid)
  non contano come stile diverso.
- **Caselle di testo**: è supportata solo la sostituzione del testo, non riordino/inserimento/rimozione.
- **Controllo anti-invenzione**, per ogni modifica: fonte citata ed esistente; nessuna tecnologia fuori dal CV base
  e dalle competenze aggiuntive (dizionario); nessun numero assente dalle fonti citate; nessun nome proprio o
  sigla a metà frase assente dal CV. Quest'ultimo controllo non si applica al tedesco (tutti i sostantivi sono
  maiuscoli). È volutamente severo: meglio scartare una riformulazione lecita che lasciar passare un'invenzione;
  ciò che viene scartato è sempre mostrato con il motivo.
- **Ritocchi manuali** dell'utente non passano dal controllo anti-invenzione (il CV è suo), ma l'app segnala se il
  testo finale contiene tecnologie assenti dal CV base.
- **Privacy**: la parte iniziale del CV (nome e contatti) non viene inviata all'LLM.
- **Stessa lunghezza**: se il PDF supera le pagine del CV base si chiede una versione più sintetica, al massimo
  due volte; poi il CV resta disponibile con un avviso, senza forzature.
- **Pagine, font e miniature** con poppler (`pdfinfo`, `pdffonts`, `pdftoppm`) nel container `api`, invece di una
  libreria PDF in Node.
- **Fixture**: i due CV di esempio (una colonna in inglese, due colonne in italiano) sono generati da
  `tests/fixtures/cv/build.js` e non contengono dati reali.
- **Migliora CV**: ogni proposta applicabile porta con sé la modifica da fare al documento, nello stesso formato e
  con lo stesso controllo anti-invenzione dei CV su misura (ciò che non lo supera non viene nemmeno proposto); ciò
  che "manca" e non è tra le aggiunte dichiarate è sempre una domanda al candidato. Applicare non tocca mai il file
  caricato: si riparte dalla versione che il controllo ha letto, con tutte le proposte in stato "applicata", e il
  risultato è una nuova versione del CV base, attiva. Finché nessun CV su misura la usa, quella versione viene
  aggiornata a ogni applicazione o annullamento (non una versione per clic); poi se ne crea una nuova. Annullate
  tutte, torna attiva la versione di partenza. L'applicazione parte da un clic dell'utente, non dal controllo
  periodico: cambiare da soli il CV con cui ci si candida, senza che nessuno lo abbia visto, sarebbe troppo. Il controllo periodico è un semplice giro orario che rivede i CV il cui ultimo controllo è più vecchio
  dell'intervallo (`cv.review` nelle impostazioni, attivo di default, 7 giorni); un fallimento si ritenta dopo un
  giorno. Le "tecnologie richieste spesso" e i "requisiti non coperti" sono conteggi locali (stack degli annunci
  accettati, `gaps` dei CV generati), calcolati senza LLM e passati anche al modello.
- **Valutazione ATS**: il modello vede solo il testo, quindi i dati sul file (caselle di testo, immagini, link,
  sezioni riconosciute, pagine, presenza di email e telefono) vengono calcolati in locale dalla struttura del DOCX
  e passati come fatti, con il divieto di ipotizzare altro sul layout (font, colonne, tabelle non sono noti).
  Passa dal servizio LLM comune: con il provider Anthropic è l'agent di Claude, ma funziona anche con gli altri.
  Su richiesta, non periodica, e salvata sulla singola versione del CV base: applicando proposte cambia il
  documento e la valutazione va rifatta. Le aggiunte dichiarate non contano come presenti: per un ATS vale solo
  ciò che è scritto nel file.
- **Cosa aggiungere nei CV** non è un dato nuovo: è `cv.extra_skills`, già usato dal controllo anti-invenzione. La
  pagina lo modifica voce per voce; le tecnologie del mercato si aggiungono con un clic, i requisiti scoperti
  passano dal campo di testo perché vanno riscritti con parole proprie.
- **CV da descrizione incollata**: la descrizione è salvata sul CV generato (`GeneratedCv.descriptionText`, senza
  `jobId`), non in un annuncio fittizio: un `Job` "manuale" finirebbe nella lista, nei filtri, nei punteggi e nella
  deduplicazione senza avere una fonte. Lo stack si ricava dal testo con lo stesso dizionario degli annunci. Senza
  annuncio non ci sono lettera né collegamento alla candidatura dalla pagina del CV; i CV manuali si ritrovano
  nell'elenco dentro la finestra "CV da descrizione".
- **Email di accompagnamento**: è un campo del CV generato (`GeneratedCv.email`), non un'entità con versioni come
  la lettera: è il testo breve con cui si invia proprio quel CV, e riscriverla sostituisce la precedente. Chiamata
  diretta all'LLM (pochi secondi), stesso controllo sulle tecnologie della lettera. "Apri nel programma di posta"
  usa un link `mailto:` senza destinatario: l'app non invia email e non conosce l'indirizzo dell'azienda.
- **Lettera di candidatura**: entità separata dal CV generato (`CoverLetter`, versioni per annuncio), perché si
  può volere la lettera senza un CV su misura e viceversa. È testo libero modificabile, non un insieme di
  modifiche: l'LLM restituisce oggetto, saluto, paragrafi e chiusura; nome, recapiti, data e firma vengono
  aggiunti in locale dalla parte iniziale del CV base, che come per il CV non viene inviata. Il DOCX è un
  documento nuovo e sobrio (A4, Calibri), non un clone del layout del CV: clonare colonne e caselle di testo per
  una pagina di prosa sarebbe fragile. La lingua è una qualsiasi di quelle abilitate: i fatti arrivano dal CV base
  di quella lingua o, se manca, dal primo disponibile.
- **Anti-invenzione nella lettera**: una prosa libera non può citare una fonte per frase, quindi il controllo è
  quello sulle tecnologie (dizionario): se la prima stesura ne cita di assenti dal CV si chiede una seconda
  stesura, poi resta un avviso. Numeri e nomi propri non vengono verificati (data, azienda e ruolo sarebbero falsi
  positivi): la lettera va riletta.
- **Scrittura in background senza coda**: è una sola chiamata all'LLM, come le domande dei colloqui; la pagina si
  aggiorna a intervalli e le lettere interrotte da un riavvio vengono segnate come fallite. Se Gotenberg non
  risponde il testo resta disponibile, con un avviso al posto di PDF e DOCX.

## Colloqui simulati

- **Domande dall'LLM già configurato** (stesso provider, modello e consenso dei CV): metà tecniche, metà
  "umane" (comportamentali), nell'ordine di un colloquio vero, nella lingua dell'annuncio rilevata in fase di
  raccolta (inglese se non rilevata). Per ogni domanda l'LLM scrive anche, in italiano, cosa valuta chi la fa:
  è il suggerimento "Cosa vogliono sentire?".
- **Valutazione di ogni risposta** con punteggio 1-5, punti di forza, cosa migliorare e una versione migliorata
  nella lingua del colloquio. Vale la stessa regola anti-invenzione dei CV: solo fatti detti dal candidato o
  presenti nel profilo, segnaposto tra parentesi quadre per gli esempi mancanti.
- **Trascrizione in locale con Whisper** (`onerahmet/openai-whisper-asr-webservice`, motore faster-whisper,
  modello `small`) in un container sotto il profilo `stt`, come Ollama per l'LLM: l'audio non lascia il computer e
  non viene salvato, nel database resta solo il testo. Scartate la dettatura del browser (Web Speech API), che in
  Chrome invia l'audio ai server di Google, e le API di trascrizione esterne.
- **La trascrizione si può correggere prima dell'invio**: errori del riconoscimento non devono pesare sul voto. La
  valutazione sa comunque se la risposta era parlata e ignora intercalari e ripetizioni.
- **Lettura delle domande con la sintesi vocale del browser** (preferendo le voci locali del sistema): nessun
  servizio in più.
- **Voce neurale opzionale con Piper in locale** (profilo `tts`): le voci di base del sistema suonano robotiche.
  Piper gira su CPU molto più veloce del tempo reale (circa un decimo della durata dell'audio), resta tutto sul
  computer e la voce è la stessa in ogni browser. Il testo viene sintetizzato una frase alla volta, così la prima
  parte subito e le altre si generano mentre parla. Se il servizio manca, cede, o non ha una voce per la lingua,
  si torna alla sintesi del browser.
- **Generazione e valutazione in background**: l'API risponde subito e la pagina rilegge lo stato ogni 2 secondi.
  Una generazione interrotta da un riavvio risulta fallita e si può riprovare.
- **Conversazione a voce a turni rapidi, non in streaming**: l'intervistatore parla con la sintesi vocale del
  browser; il candidato parla, l'audio viene tagliato sulle pause e trascritto a pezzi mentre sta ancora parlando
  (Whisper impiega circa un quinto della durata dell'audio, sui pezzi corti), così a fine risposta resta da trascrivere solo
  l'ultimo pezzo; la replica arriva da un modello rapido senza ragionamento esteso (misurato: meno di 2 secondi
  con Claude Sonnet tramite Agent SDK). In tutto, qualche secondo dopo che si smette di parlare: non è
  istantaneo come una chiamata, ma regge una conversazione. Non c'è interruzione reciproca (barge-in).
- **Riepilogo dei temi prima di iniziare**: generato nella stessa chiamata che scrive le domande (nessuna attesa
  in più), dalla descrizione dell'annuncio: una sintesi del ruolo e 4-5 temi con cosa tenere pronto, senza
  anticipare le domande. È un di più: se il modello non lo produce il colloquio si fa lo stesso.
- **Replica in streaming**: la battuta dell'intervistatore arriva a pezzi (eventi `say` su
  `live/turn/stream`) mentre il modello la scrive, e ogni frase va in sintesi vocale appena è completa
  (misurato con Claude tramite Agent SDK: primo testo a 1,5 s, replica completa a 2,4 s). I provider che non
  mandano il testo a pezzi funzionano lo stesso: la battuta viene pronunciata tutta alla fine.
- **Pezzi di audio corti**: Whisper rallenta molto sui pezzi lunghi (misurato: 4 s per 22 s di audio, oltre un
  minuto per 52 s), quindi la risposta si taglia dopo 4 secondi alla prima pausa di mezzo secondo e, oltre i
  10 secondi, anche su una pausa minima. La quantizzazione int8 non ha dato vantaggi misurabili.
- **Trascrizioni fantasma scartate**: sull'audio quasi muto Whisper ripete il suggerimento (titolo
  dell'annuncio) o frasi fatte da sottotitoli; quei testi non diventano la risposta del candidato.
- **Segnali acustici**: due note che salgono quando tocca al candidato, due che scendono quando la risposta è
  stata presa, per non dover guardare lo schermo.
- **Fine del turno**: a mani libere, 2,2 secondi di silenzio dopo aver parlato (soglia di volume fissa); sempre
  disponibile la chiusura manuale, per chi vuole pensare in silenzio.
- **Struttura garantita dal codice, non dal modello**: le domande principali sono quelle generate all'inizio; a
  ogni turno l'LLM sceglie solo tra contro-domanda (max 1 per domanda e non più della metà delle domande in tutto il colloquio; di norma si va avanti: la contro-domanda è solo per risposte fuori tema o del tutto generiche), chiarimento (max 2) e domanda successiva,
  e le azioni non più ammesse vengono rifiutate dalla validazione. La prima battuta è un saluto fisso più la prima
  domanda, senza attesa. Durante il colloquio l'intervistatore non valuta né corregge.
- **Modello rapido** per le sole repliche (`scoring.llm.fast_model`; vuoto = `claude-sonnet-5-5` con Anthropic,
  altrimenti il modello principale). Domande e valutazione finale usano sempre il modello principale.
- **Domande e valutazione da colloquio umano**: le prime versioni producevano domande da esame (dettagli di API,
  elenchi, terminologia di nicchia) e bocciavano risposte sensate ma non "da manuale". Ora il prompt chiede
  situazioni e scelte a cui si risponde ragionando, vieta esplicitamente ciò che si sa solo a memoria, e la
  valutazione (per risposta e finale) giudica ragionamento e basi, non i termini usati né la completezza.
- **Piccoli aiuti**: due per domanda, generati insieme alle domande (direzione, poi punto di partenza; mai la
  risposta). A turni si scoprono a richiesta; a voce sono una nuova mossa dell'intervistatore (`hint`, una per
  domanda) quando il candidato è bloccato, e non contano come contro-domande né abbassano il voto. I colloqui
  creati prima non hanno aiuti: il pulsante non compare.
- **Colloquio proposto in homepage**: scelta casuale lato API tra le candidature inviate (non `skipped`) che hanno
  già il testo dell'annuncio, così il colloquio parte senza incollare nulla; valgono anche quelle rifiutate o senza
  risposta: esercitarsi serve comunque. La proposta resta ferma finché non se
  ne chiede un'altra; la chiusura è salvata nel browser e vale fino a fine giornata, così la card non sparisce
  per sempre. Colore dedicato (`--highlight`, viola) per non confonderla con azioni primarie e avvisi.
- **Niente valutazione di lessico e grammatica**: il livello QCER e la tabella degli errori sono stati tolti perché
  la trascrizione automatica non riporta fedelmente le parole dette, e gli "errori" segnalati erano spesso della
  trascrizione. Il prompt vieta commenti sulla lingua in tutto il report.
- **Valutazione finale unica** (correttezza dei contenuti per domanda, tono, priorità) su tutta la
  trascrizione, anche per la modalità a turni. Il ritmo (parole al minuto) è calcolato dall'app sulle risposte a
  voce. Il tono è giudicato da parole e ritmo: l'audio non viene analizzato (né conservato), quindi niente
  pronuncia o intonazione; l'interfaccia lo dichiara.
- **Storico separato dalle candidature** (`InterviewSession`, `InterviewAnswer`), con titolo, azienda e testo
  dell'annuncio copiati nella sessione: resta anche se l'annuncio viene eliminato, e le valutazioni usano sempre
  il testo con cui sono state generate le domande.
- **Anche dalle candidature**: si usa il testo dell'annuncio collegato se esiste ancora, altrimenti la copia salvata
  con la candidatura; sotto i 150 caratteri la descrizione va incollata. Quella incollata viene salvata nella
  candidatura (solo se lì mancava), così i tentativi successivi non la richiedono. Lingua "automatica" =
  rilevata dal testo incollato, come per gli annunci raccolti.
- **Tentativi**: numerati per annuncio o candidatura (una candidatura con annuncio collegato condivide la
  numerazione con l'annuncio). Domande diverse a ogni tentativo: a ogni generazione si estraggono a caso i temi
  tecnici e umani da coprire (da due elenchi fissi) e si passano all'LLM le domande degli ultimi tre tentativi
  da non ripetere. Il Claude Agent SDK non espone la temperatura: la varietà viene dal prompt, non dal
  campionamento.

## Interfaccia

- **Colore primario blu, non giallo**: `todo.md` chiedeva un giallo ambrato; su richiesta successiva il primario è
  un blu "business" neutro tendente all'azzurro (`oklch(0.53 0.14 245)`), con neutri freddi poco saturi. Gli avvisi
  usano un ambra dedicato (`--warning-*`), così restano distinguibili dalle azioni primarie.
- **Dati differenziati nelle card**: azienda con avatar a iniziali (tinta derivata dal nome), retribuzione in
  verde, area geografica in verde acqua (con bandiere se l'annuncio è limitato a pochi paesi), data in viola se
  recente; contratto e seniority restano neutri. Ogni badge ha icona ed etichetta: il colore non è mai l'unico
  segnale.
- **Tecnologie cliccabili**: nelle card e nel dettaglio, cliccando una tecnologia si apre un menu per aggiungerla
  (o toglierla) dalle keyword preferite, richieste o escluse del Profilo. Il salvataggio è immediato, crea una
  voce

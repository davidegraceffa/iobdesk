# Guida all'uso di Iobdesk

Questa guida descrive ogni funzione in dettaglio. Per installare e avviare l'app parti dal [README](../README.md).

- [Primo avvio: onboarding](#primo-avvio-onboarding)
- [Configurazione](#configurazione)
- [Usare l'app](#usare-lapp)
- [Importare candidature da un foglio di calcolo](#importare-candidature-da-un-foglio-di-calcolo)
- [Candidature da Gmail](#candidature-da-gmail)
- [CV su misura](#cv-su-misura)
- [Colloqui simulati](#colloqui-simulati)
- [LLM](#llm)
- [Notifiche Telegram](#notifiche-telegram)
- [Import degli alert via email](#import-degli-alert-via-email-linkedin-indeed-glassdoor)

## Primo avvio: onboarding

Alla prima apertura l'app chiede tre cose: **paese di residenza**, se hai una **partita IVA / VAT number**, e il
**fuso orario** (precompilato dal paese). Finché non salvi, non viene raccolto nessun annuncio. Subito dopo il
salvataggio parte la prima raccolta: in circa un minuto la lista si popola.

Da questi dati dipendono:

- le **aree accettate** (es. per `IT`: Italy, Europe, EU, EEA, EMEA, CET, Worldwide) e gli annunci scartati perché
  limitati ad altri paesi ("US only", "must reside in Canada"…), sempre con un motivo leggibile;
- la **valuta** in cui vengono convertiti gli stipendi (tassi statici, modificabili nel Profilo);
- il controllo sul **fuso orario** richiesto dagli annunci;
- il trattamento dei ruoli **contract/B2B** se non hai la P.IVA: penalizzati (default), esclusi o lasciati così.
  I contratti tramite Employer of Record (Deel, Remote.com, Oyster…) non vengono mai penalizzati.

Per saltare l'onboarding puoi valorizzare `user.country` e `user.has_vat_number` in `config/search.yaml` **prima**
del primo avvio.

## Configurazione

Tutte le impostazioni si modificano e si salvano dalla sezione **Profilo** dell'interfaccia, con il pulsante
"Salva" in basso. La fonte di verità è il database:

- `config/search.yaml` viene letto **una sola volta**, al primo avvio, per il seed iniziale, e non viene mai riscritto;
- ogni salvataggio è validato (stesso schema nel form e nell'API), crea una voce nello **storico** ripristinabile e
  fa ricalcolare in background filtri e punteggi di tutti gli annunci;
- prima di salvare vedi quanti annunci passerebbero i nuovi criteri;
- dal Profilo puoi **esportare** le impostazioni in YAML/JSON e **importarle** da file, con anteprima delle differenze.

I segreti (token Telegram, credenziali IMAP, client OAuth di Google, chiavi API) restano nel file `.env`: non
vengono mai salvati nel database né mostrati nell'interfaccia, che indica solo se sono configurati. Dopo aver
modificato `.env`:

```bash
docker compose up -d
```

## Usare l'app

La pagina **Annunci** si apre filtrata sullo stato **Nuovo** (gli annunci ancora da guardare): per vedere anche
quelli salvati o a cui ti sei candidato cambia il filtro Stato.

- **Annunci**: ogni annuncio mostra sempre la fonte (e le altre fonti su cui è stato trovato), la RAL come scritta
  nell'annuncio con la conversione nella tua valuta — oppure "RAL non indicata" (una stima compare solo se la
  chiedi tu, vedi più sotto) —, lo stack
  raggruppato per categoria, la descrizione originale e il pulsante "Candidati".
- **Scorciatoie**: `j`/`k` naviga, `Invio` apre il dettaglio, `s` salva, `a` segna come candidato, `d` scarta,
  `o` apre l'originale, `c` genera il CV, `/` cerca, `?` mostra l'elenco.
- **Candidature**: dopo "Candidati", al ritorno sulla scheda l'app chiede "Ti sei candidato?" e registra la
  candidatura con una copia dell'annuncio. Lo storico (tabella o kanban, con timeline, follow-up ed export CSV)
  resta consultabile anche quando l'annuncio non esiste più. Nel dettaglio di una candidatura puoi correggere
  contatto, nazione, CV inviato, note e inserire o modificare la **RAL**.
- **Aziende bloccate**: dal dettaglio di un annuncio, **Blocca azienda** scarta tutte le offerte di quell'azienda,
  presenti e future (conta il nome intero, senza maiuscole né forma societaria). L'elenco si modifica in
  **Profilo → Criteri di ricerca**; gli annunci scartati restano visibili con "Mostra scartati", con il motivo.
- **Fonti**: stato, ultima raccolta, errori e rilevanza per il tuo paese; pulsanti per aggiornare a mano.

## Importare candidature da un foglio di calcolo

Se tieni traccia delle candidature in un foglio (Google Sheets, Excel), puoi portarle nello storico:

1. Scarica il foglio come CSV (in Google Sheets: File → Scarica → Valori separati da virgola).
2. In **Candidature** premi **Importa CSV**, scegli il file e controlla l'anteprima: quante candidature sono nuove,
   quante da aggiornare, quali righe hanno problemi.
3. Conferma con **Importa**.

Colonne riconosciute (l'ordine non conta, quelle sconosciute vengono ignorate): `ID offerta`, `Data candidatura`,
`Azienda`, `Posizione`, `Località`, `Portale`, `Link offerta`, `CV inviato`, `Lingua`, `Modalità`, `Stato`, `Note`,
`Nazione`. Servono almeno la data e una tra azienda e posizione. Gli stati `INVIATA`, `RIFIUTATA`, `COLLOQUIO`,
`SALTATA…` diventano gli stati dell'app; il portale determina il canale (Indeed → portale di annunci, Workday/Ashby/
Lever… → ATS, "Sito aziendale" → pagina careers).

Reimportare lo stesso file, o una versione aggiornata, non crea doppioni: le righe si riconoscono dall'`ID offerta`.
Se lo stato nel file è cambiato viene aggiornato con un evento nella timeline; gli altri campi vengono riempiti
solo se nell'app sono ancora vuoti, così ciò che hai scritto a mano non viene sovrascritto. L'export CSV dello
storico usa le stesse colonne, quindi si può reimportare così com'è.

## Candidature da Gmail

L'app può leggere la tua posta Gmail (**in sola lettura**, tramite le API di Google) e tenere aggiornato lo storico
da sola:

- le **email di conferma** ("candidatura inviata", "thank you for applying", "merci pour votre candidature"…)
  diventano candidature con modalità "Da email", con azienda, posizione, portale, nazione e link alla conversazione;
- le **risposte negative** portano a "Rifiutata" la candidatura a cui si riferiscono, con un evento nella timeline;
  un rifiuto per una candidatura mai registrata ne crea una già rifiutata.

Le candidature già presenti (registrate dall'app, a mano o importate dal foglio) non vengono duplicate. Ogni rifiuto
applicato lascia un marcatore nelle note (`rifiuto: mail-…`): se poi correggi lo stato a mano, non viene
sovrascritto. Quando un rifiuto può riferirsi a più candidature della stessa azienda l'app non sceglie: lo segnala
nella pagina Candidature e lo stato va aggiornato a mano. Il contenuto delle email viene letto e scartato: non viene
salvato (a parte l'oggetto, nelle note) né inviato all'LLM o ad altri servizi.

### Collegare Gmail (una volta sola)

Serve un progetto Google Cloud personale, gratuito:

1. Su <https://console.cloud.google.com/> crea un progetto e, in **API e servizi → Libreria**, attiva la **Gmail API**.
2. **Schermata consenso OAuth**: tipo _Esterno_, la tua email come contatto e tra gli _Utenti di test_.
3. **Credenziali → Crea credenziali → ID client OAuth**, tipo **App desktop**. Copia ID e segreto in `.env`:

   ```bash
   GOOGLE_CLIENT_ID=…
   GOOGLE_CLIENT_SECRET=…
   ```

4. `docker compose up -d`, poi in **Profilo → Fonti → Candidature da Gmail** premi **Collega Gmail**: si apre la
   pagina di Google, scegli l'account e consenti la lettura della posta. Google rimanda il browser all'app
   (`http://127.0.0.1:<APP_PORT>/api/mail/oauth/callback`).
5. Attiva **Aggiorna le candidature in automatico**, scegli l'intervallo e salva.

L'autorizzazione (refresh token) viene salvata in un volume Docker dedicato, non nel database, e non è mai
restituita dall'API. **Scollega** la revoca presso Google e cancella il file.

> Finché l'app OAuth resta in stato **Test**, Google fa scadere l'autorizzazione dopo 7 giorni e l'app chiede di
> ricollegare Gmail. Per evitarlo, nella schermata di consenso premi **Pubblica app** ("In produzione"): per un uso
> personale non serve la verifica di Google.

### Aggiornare a mano

In **Candidature** premi **Aggiorna da Gmail**: vedi l'anteprima (candidature nuove, stati da aggiornare, rifiuti
ambigui, email scartate e perché) e confermi. Da riga di comando:

```bash
docker compose exec api node dist/cli mail-sync --dry-run   # solo anteprima
docker compose exec api node dist/cli mail-sync --days 90   # scrive, guardando gli ultimi 90 giorni
```

Finestra di ricerca, numero massimo di email, mittenti da ignorare e filtro Gmail aggiuntivo si impostano nella
stessa sezione del Profilo.

## CV su misura

1. Vai in **Profilo → CV** e carica un CV per lingua (fino a 3) in formato **DOCX**. Il PDF non è accettato come
   base: solo il DOCX permette di cambiare i testi mantenendo font, colori, colonne e impaginazione
   (esportalo da Word, Google Docs o LibreOffice).
2. Controlla la **struttura riconosciuta** (sezioni e paragrafi adattabili) e correggila se serve.
3. Facoltativo ma consigliato: elenca le **competenze aggiuntive** reali che non compaiono nel CV.
4. Attiva un LLM in **Profilo → Avanzate** (vedi sotto).
5. Su un annuncio premi **Genera CV**: scegli lingua e istruzioni, segui l'avanzamento, poi rivedi il risultato:
   anteprima PDF, confronto con il CV base, ogni modifica con prima/dopo e motivo — accettabile, rifiutabile o
   ritoccabile a mano —, copertura dei requisiti, download PDF/DOCX e collegamento alla candidatura.

Regole sempre applicate: il CV generato **non inventa nulla** (ogni modifica deve citare la fonte nel CV base o
nelle competenze aggiuntive; tecnologie, numeri e nomi assenti vengono scartati e mostrati a parte), non tocca
nome, contatti, date, aziende e titoli di studio, mantiene lo stile del documento e non supera il numero di
pagine del CV base. I requisiti scoperti compaiono solo come suggerimenti.

### Migliora CV

La sezione **Migliora CV** rilegge periodicamente ogni CV base (di default ogni 7 giorni; frequenza e interruttore
sono in cima alla pagina, e c'è sempre "Controlla ora") rispetto ai ruoli che cerchi e a ciò che chiedono gli
annunci compatibili, e propone cosa migliorare:

- **riformulazioni** di singoli paragrafi, con prima/dopo evidenziato (solo fatti già nel CV), paragrafi **da
  togliere**, **riordini** di bullet e competenze, e **nuovi paragrafi** costruiti dalle cose che hai dichiarato
  tra le aggiunte;
- cose **da aggiungere se sono vere** (formulate come domande: l'app non le dà per buone) e consigli generali di
  struttura, che richiedono una tua scelta.

Le proposte del primo gruppo le **applica l'app**: con **Applica al CV** (o **Applica tutte**) viene generata una
**nuova versione del CV base**, con lo stesso aspetto dell'originale, che diventa quella in uso e si scarica in
DOCX o PDF dalla stessa pagina. Il file che hai caricato resta archiviato tra le versioni e ogni proposta applicata
si può annullare: il documento viene rigenerato senza. Le proposte applicate, fatte o ignorate non vengono
riproposte ai controlli successivi.

Sempre lì, **Valuta ATS** stima come un sistema di selezione automatica leggerebbe e classificherebbe il CV per i
ruoli che cerchi: punteggio da 0 a 100, cinque aree (leggibilità per il parser, struttura, parole chiave,
contenuto delle esperienze, lunghezza e formato), i problemi con la correzione e le parole chiave trovate e
assenti. La valutazione la fa l'LLM configurato (con Anthropic, l'agent di Claude) sul testo del CV e sui dati
tecnici ricavati dal file (caselle di testo, immagini, sezioni riconosciute, pagine); vale per la versione su
cui è stata fatta e va rilanciata dopo aver applicato delle proposte. È una stima: ogni ATS si comporta in modo
diverso.

Nella stessa pagina gestisci **cosa aggiungere nei CV**: l'elenco di competenze ed esperienze reali che il CV base
non mostra (lo stesso della scheda CV del Profilo), da cui attingono CV su misura, lettere ed email. Puoi scrivere
voci a mano oppure aggiungerle con un clic dalle **tecnologie più richieste** negli annunci compatibili degli
ultimi 60 giorni che non compaiono nel tuo CV, e dai **requisiti non coperti** nei CV già generati.

### CV da una descrizione incollata

Per un annuncio che non è tra quelli raccolti (visto altrove, ricevuto via email), in cima alla pagina **Annunci**
c'è **CV da descrizione**: inserisci ruolo e azienda, incolla il testo dell'annuncio, scegli la lingua e genera. Il
risultato si rivede e si scarica come ogni altro CV su misura, con le stesse regole; la stessa finestra elenca i CV
già generati così, e "Rigenera" ripropone la descrizione per correggerla o cambiare istruzioni.

### Email di accompagnamento

Nella pagina di ogni CV generato (anche quelli da descrizione incollata) la scheda **Email** scrive il testo breve
dell'email con cui inviare il CV in allegato: oggetto e corpo nella lingua del CV, costruiti sull'annuncio e solo
sui contenuti del tuo CV, con la firma aggiunta in locale. Puoi dare istruzioni (tono, un dettaglio da citare),
ritoccare e salvare il testo, copiarlo o aprirlo già compilato nel programma di posta; riscriverla sostituisce la
precedente.

### Stima della RAL

Se un annuncio non indica la retribuzione, nel suo dettaglio compare **Genera RAL**: l'LLM propone un intervallo
lordo annuo plausibile per quel ruolo, quella seniority e l'area geografica da cui arriva l'offerta, con una breve
motivazione e un livello di affidabilità. È una **stima**, mostrata sempre come tale (anche nella lista, con la
conversione nella tua valuta se il tasso è configurato) e mai usata da filtri e punteggi: la soglia di RAL minima
continua a valere solo per le retribuzioni scritte negli annunci. Si può rigenerare in ogni momento.

### Lettera di candidatura

Dal dettaglio di un annuncio (o dalla pagina di un CV generato) premi **Scrivi lettera**: scegli la lingua e, se
vuoi, aggiungi istruzioni (tono, un progetto da citare). La lettera viene scritta sull'annuncio usando solo i
contenuti del tuo CV base e delle competenze aggiuntive; si può scrivere in qualunque lingua abilitata nel
Profilo, anche senza un CV base in quella lingua. Nella pagina della lettera puoi ritoccare oggetto e testo,
vedere l'anteprima, copiare il testo o scaricare **PDF e DOCX** (con intestazione, data e azienda già
impaginate), oppure farla riscrivere con nuove istruzioni: ogni riscrittura è una nuova versione, elencata nel
dettaglio dell'annuncio. Se il testo cita tecnologie che non compaiono nel tuo CV, la pagina lo segnala.

## Colloqui simulati

**Simula colloquio** prepara un colloquio su un'offerta, dal dettaglio di un **annuncio** oppure di una
**candidatura** (anche passata, importata dal foglio o da Gmail): domande **tecniche** (sulle tecnologie,
responsabilità e problemi citati, alla seniority del ruolo) e **umane** (motivazione, lavoro in team, conflitti,
comunicazione…), nella **lingua dell'annuncio** (modificabile). Scegli quante domande (da 4 a 12, metà tecniche e
metà umane).

Se la candidatura non ha la descrizione dell'annuncio (capita con quelle importate o arrivate da Gmail), la
finestra chiede di **incollarla**; la lingua può essere rilevata dal testo. La descrizione incollata resta
salvata con la candidatura.

Ogni volta che rifai il colloquio sulla stessa offerta è un **nuovo tentativo** con **domande nuove**: temi
estratti a caso e divieto di ripetere le domande dei tentativi precedenti. Lo storico dei tentativi (numero,
data, risposte, punteggio medio) è nella pagina **Colloqui**, nel dettaglio dell'annuncio o della candidatura e in
cima al colloquio, con il pulsante **Nuovo tentativo con altre domande**.

Le domande sono pensate come in un **colloquio vero**: situazioni pratiche, scelte e ragionamenti a cui una persona
competente risponde con l'esperienza e le conoscenze di base, non nozioni da manuale (nomi esatti di funzioni,
opzioni, numeri, definizioni). Anche la valutazione guarda se il **ragionamento regge** e se le basi ci sono, non
se hai usato i termini più specifici o coperto ogni aspetto. Ogni domanda ha due **piccoli aiuti**: nelle domande e
risposte li scopri uno alla volta con "Dammi un aiuto"; a voce è l'intervistatore a dartene uno se dici di non
sapere o ti blocchi (al massimo uno per domanda), senza che questo abbassi il voto.

Due modalità, scelte all'avvio:

- **Prima di iniziare** vedi un breve riepilogo ricavato dall'annuncio: cosa cerca il ruolo e i temi principali
  su cui verterà il colloquio, con cosa tenere pronto per ciascuno.
- **Conversazione a voce** (predefinita): l'intervistatore ti saluta e fa la prima domanda a voce (sintesi vocale del
  browser), tu rispondi al microfono e lui replica in pochi secondi: di norma passa alla domanda successiva;
  fa una **contro-domanda** solo se la risposta è fuori tema o del tutto generica (al massimo una per domanda, e
  non su più di metà delle domande), un chiarimento se gli chiedi di
  ripetere, oppure la domanda successiva. A **mani libere** il tuo turno si chiude da solo dopo un paio di secondi
  di silenzio; altrimenti premi "Ho finito di rispondere". Puoi anche scrivere la risposta, far ripetere la domanda o
  chiudere in anticipo con "Termina e valuta". Meglio con le cuffie.
- **Domande e risposte**: una domanda alla volta; registri (massimo 5 minuti) o scrivi la risposta, puoi correggere
  la trascrizione, e ogni risposta riceve subito un voto da 1 a 5 con punti di forza, cosa migliorare e una
  **versione più efficace**, costruita solo su ciò che hai detto e sul tuo profilo (dove manca un esempio compare un
  segnaposto tra [parentesi], non un'esperienza inventata).

Alla fine, in entrambe le modalità, la **valutazione finale** giudica:

- **Correttezza dei contenuti**, domanda per domanda: cosa hai detto di giusto, cosa era sbagliato o impreciso (con
  la correzione) e cosa mancava;
- **Tono**: sicurezza o esitazione, chiarezza, concisione, professionalità, più il **ritmo** misurato (parole al
  minuto). È valutato dalle parole e dal ritmo: pronuncia e intonazione non vengono analizzate, perché la
  valutazione lavora sulla trascrizione, non sull'audio;
- le **priorità** su cui lavorare prima di un colloquio vero.

Lessico e grammatica **non vengono valutati**: la trascrizione automatica non riporta abbastanza fedelmente le
parole dette per giudicarle.

In cima alla pagina **Annunci** una card in evidenza propone ogni volta un **colloquio su una candidatura passata
scelta a caso** (tra quelle che hanno già il testo dell'annuncio salvato), con ruolo, azienda, data e stato della
candidatura, tecnologie, lingua e i tentativi già fatti: da lì avvii il colloquio, ne chiedi un'altra o la chiudi (ricompare il giorno dopo).

Il pulsante **Simula colloquio** è anche in ogni riga (e in ogni scheda del kanban) della pagina Candidature.

I colloqui restano in **Colloqui** (anche se l'annuncio viene eliminato), con la valutazione.

Serve un LLM attivo (Profilo → Avanzate). Con un provider esterno viene chiesto il consenso, come per i CV: vengono
inviati annuncio, profilo e il **testo** delle risposte.

**Risposte a voce: trascrizione locale.** L'audio viene trascritto da Whisper in un container dedicato, sul tuo
computer, e non viene salvato. Il servizio è opzionale:

```bash
docker compose --profile stt up -d     # il primo avvio scarica l'immagine e il modello (qualche centinaio di MB)
```

Per avviarlo sempre insieme all'app aggiungi `COMPOSE_PROFILES=stt` al file `.env`. Il modello si sceglie con
`WHISPER_MODEL` (`small` di default; `base` è più veloce, `medium` più preciso). Senza il servizio si può
comunque rispondere per iscritto. Il microfono funziona aprendo l'app da `http://127.0.0.1` o `http://localhost`.

**Voce dell'intervistatore: sintesi neurale locale.** Con il container Piper l'intervistatore (e la lettura delle
domande) usa una voce neurale generata sul tuo computer; senza, parla la sintesi vocale del browser. Opzionale:

```bash
docker compose --profile tts up -d --build   # il primo avvio scarica le voci (circa 60 MB l'una)
```

Le voci si scelgono con `PIPER_VOICES` (una per lingua; di default italiano, inglese e francese): per le lingue
senza voce resta la sintesi del browser. Per avviare sempre trascrizione e voce: `COMPOSE_PROFILES=stt,tts`.

## LLM

L'LLM è **facoltativo e disattivato di default**. Serve per il punteggio LLM dei nuovi annunci, per i CV e le
lettere su misura, per i colloqui simulati e per la stima della RAL.

**Locale (consigliato): Ollama**

```bash
docker compose --profile llm up -d
docker compose exec ollama ollama pull llama3.1
```

Poi in **Profilo → Avanzate**: attiva "Usa un LLM", provider Ollama, modello `llama3.1`. I dati restano sul tuo computer.

**Esterno: Claude (Agent SDK) o OpenAI**

1. Metti le credenziali in `.env` e rilancia `docker compose up -d`:
   - Claude: `ANTHROPIC_API_KEY` (chiave della Claude Console) **oppure** `CLAUDE_CODE_OAUTH_TOKEN` (token a lunga
     durata del tuo abbonamento Claude: si genera sul tuo computer con `claude setup-token`). Se ci sono entrambe
     vale il token.
   - OpenAI: `OPENAI_API_KEY`.
2. In **Profilo → Avanzate** scegli il provider e il modello.
3. L'interfaccia avvisa che annunci e CV (dati personali inclusi) verranno inviati a terzi e chiede un **consenso
   esplicito**, salvato nelle impostazioni e revocabile. Senza consenso l'LLM non viene usato.

`LLM_PROVIDER` in `.env`, se valorizzato, forza il provider scelto nelle impostazioni.

## Notifiche Telegram

1. Crea un bot con [@BotFather](https://t.me/BotFather) e copia il token.
2. Scrivi un messaggio al bot, poi leggi il tuo chat id (campo `chat.id`) da
   `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. In `.env` imposta `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID`, poi `docker compose up -d`.
4. In **Profilo → Avanzate** attiva le notifiche e scegli il punteggio minimo.

## Import degli alert via email (LinkedIn, Indeed, Glassdoor)

L'app non fa scraping di questi siti. Se vuoi comunque vederne gli annunci, puoi importare le **email di alert**
che ricevi:

1. Nel tuo client di posta crea un'etichetta/cartella dedicata (es. `job-alerts`) e una regola che ci sposti gli alert.
2. In `.env` imposta `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` (per Gmail: una "password per le app")
   e `IMAP_MAILBOX`, poi `docker compose up -d`.
3. In **Profilo → Fonti** abilita "Alert via email".

La casella viene letta in sola lettura. Dall'email arrivano solo titolo, azienda e località: la descrizione
completa resta sul sito originale.

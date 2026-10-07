# Fonti

Regola generale: **solo API pubbliche, endpoint JSON pubblici e feed RSS**. Nessuno scraping di siti che lo vietano
(LinkedIn, Indeed, Glassdoor…): per quelli è previsto soltanto l'import opzionale delle email di alert che ricevi.

Tutte le richieste passano da `SourceHttpService`: User-Agent descrittivo, una richiesta alla volta per fonte con
almeno 1,5 secondi di pausa, timeout di 30 secondi, un solo retry sugli errori temporanei, richieste condizionali
(ETag / Last-Modified) dove la fonte le supporta. Il fallimento di una fonte non blocca le altre: l'errore viene
loggato e mostrato nella pagina Fonti.

## Fonti implementate

Endpoint e formati verificati il **2026-10-01** con richieste reali fatte da dentro il container; un campione di
ogni risposta, reso anonimo (aziende, link, contatti e identificativi fittizi, descrizioni accorciate), è salvato in
`tests/fixtures/sources/` ed è ciò contro cui girano i test (nessuna rete nei test).

| Fonte                                           | Endpoint                                                                                                                                                                             | Note sul formato reale                                                                                                                                                                                                                                                                                                                                          | Intervallo minimo |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Remotive (`remotive`)                           | `GET https://remotive.com/api/remote-jobs?category=software-dev`                                                                                                                     | JSON `{ jobs: [...] }`. Oggi restituisce un campione ridotto (16 annunci) di tutte le categorie e ignora `category`, `search` e `limit`: il filtro lo fa la pipeline. `salary` è testo libero. La fonte chiede poche richieste al giorno.                                                                                                                       | 360 min           |
| Remote OK (`remoteok`)                          | `GET https://remoteok.com/api`                                                                                                                                                       | Array JSON; il **primo elemento è la nota legale**. `salary_min`/`salary_max` in USD annui (0 se assenti). I termini richiedono attribuzione e link alla pagina originale: l'app la mostra e "Candidati" porta sempre lì.                                                                                                                                       | 15 min            |
| Arbeitnow (`arbeitnow`)                         | `GET https://www.arbeitnow.com/api/job-board-api?page=N`                                                                                                                             | JSON `{ data, links, meta }`, ~325 annunci per pagina, si seguono 2 pagine tramite `links.next`. Flag `remote` (se `false` l'annuncio non è mai considerato full remote). Mercato europeo, soprattutto Germania.                                                                                                                                                | 60 min            |
| Himalayas (`himalayas`)                         | `GET https://himalayas.app/jobs/api/search?q=<keyword>&sort=recent&page=N`                                                                                                           | Il feed completo ha ~100.000 annunci a 20 per pagina, quindi si usa la ricerca con le prime 3 keyword richieste del profilo, 2 pagine ciascuna. `locationRestrictions` (paesi) e `timezoneRestrictions` (offset UTC) sono strutturati; stipendio in `minSalary`/`maxSalary`/`currency`/`salaryPeriod`.                                                          | 60 min            |
| Jobicy (`jobicy`)                               | `GET https://jobicy.com/api/v2/remote-jobs?count=100&industry=dev`                                                                                                                   | JSON `{ jobs: [...] }` con `jobGeo`, `jobType`, `jobLevel` e stipendio strutturato. La fonte chiede attribuzione con link e candidatura dalla pagina originale.                                                                                                                                                                                                 | 60 min            |
| We Work Remotely (`weworkremotely`)             | Feed RSS `https://weworkremotely.com/categories/remote-{programming,full-stack-programming,back-end-programming,front-end-programming}-jobs.rss`                                     | Titolo nella forma `Azienda: Ruolo`; campi `region`, `skills`, `type`; descrizione HTML con entità codificate (a volte vuota). Supporta ETag.                                                                                                                                                                                                                   | 60 min            |
| Hacker News "Who is hiring?" (`hn_whoishiring`) | API Algolia: `search_by_date?tags=story,author_whoishiring` per trovare il thread, poi `search_by_date?tags=comment,story_<id>&numericFilters=parent_id=<id>&hitsPerPage=100&page=N` | Si usa **l'ultimo thread disponibile** (quello del mese esce il primo giorno lavorativo). Ogni commento di primo livello è un annuncio in testo libero: la prima riga, separata da `\|`, viene interpretata con euristiche (azienda, ruolo, località, REMOTE/ONSITE, contratto). I commenti che non seguono la convenzione vengono ignorati.                    | 180 min           |
| Alert via email (`email_alerts`)                | IMAP in sola lettura sulla cartella `IMAP_MAILBOX`                                                                                                                                   | Legge gli alert di LinkedIn/Indeed/Glassdoor ricevuti negli ultimi 14 giorni e ne estrae link, titolo, azienda e località. Disattivata di default; credenziali solo in `.env`. Il parser è euristico e testato su email di esempio costruite a mano: i template reali cambiano spesso, se un alert non viene letto correttamente va adattato `parseAlertEmail`. | 15 min            |

L'intervallo effettivo di ogni fonte è il maggiore tra quello configurato nel Profilo e il minimo dichiarato
dall'adapter. Le raccolte manuali (pulsante "Aggiorna", `cli fetch`) a meno di 5 minuti dall'ultima riuscita
riusano i dati già salvati; `cli fetch --force` salta questa attesa.

Se un endpoint smette di esistere o cambia formato, l'adapter lancia un `SourceFormatError` esplicito (visibile nella
pagina Fonti) invece di interpretare dati inattesi: va riverificato l'endpoint, aggiornata la fixture e adattato
`normalize`.

## Aggiungere una fonte

Serve **un file** in `apps/api/src/sources/adapters/` più la registrazione.

1. **Verifica l'endpoint** dal container e salva un campione come fixture:

   ```bash
   docker compose exec api node -e "fetch('https://example.com/api/jobs').then(r=>r.text()).then(t=>console.log(t.slice(0,2000)))"
   ```

   Controlla i termini d'uso: l'accesso automatico deve essere consentito.

2. **Scrivi l'adapter** implementando `SourceAdapter`:

   ```ts
   // apps/api/src/sources/adapters/example.adapter.ts
   import { Injectable } from '@nestjs/common';
   import {
     SourceFormatError,
     type FetchContext,
     type JobInput,
     type RawJob,
     type SourceAdapter,
   } from '../source.types';
   import { asDate, asString, asStringArray } from './helpers';

   @Injectable()
   export class ExampleAdapter implements SourceAdapter {
     readonly id = 'example';
     readonly displayName = 'Example Jobs';
     readonly homepage = 'https://example.com';
     readonly relevantRegions = ['europe']; // usato per suggerire la fonte in base al paese
     readonly attribution = 'Annunci forniti da Example'; // se la fonte lo richiede
     readonly minIntervalMinutes = 60;

     static readonly URL = 'https://example.com/api/jobs';

     async fetchJobs(ctx: FetchContext): Promise<RawJob[]> {
       const body = await ctx.http.getJson<{ jobs?: unknown }>(ExampleAdapter.URL);
       if (!body || !Array.isArray(body.jobs)) throw new SourceFormatError(this.id, 'campo "jobs" assente');
       return body.jobs as RawJob[];
     }

     normalize(raw: RawJob): JobInput {
       return {
         source: this.id,
         externalId: asString(raw.id),
         sourceUrl: asString(raw.url),
         title: asString(raw.title),
         company: asString(raw.company),
         descriptionOriginal: asString(raw.description), // testo/HTML integrale, mai riassunto
         tags: asStringArray(raw.tags),
         location: asString(raw.location),
         publishedAt: asDate(raw.published_at),
       };
     }
   }
   ```

   `normalize` deve solo mappare i campi della fonte. Tutto il resto lo fa la pipeline, uguale per tutte le fonti:
   sanitizzazione dell'HTML, retribuzione (prima `salary` strutturato se lo valorizzi, poi il testo), stack
   tecnologico, restrizioni geografiche e di fuso, P.IVA/EOR, seniority, link di candidatura, deduplicazione,
   filtri e punteggio. I campi opzionali `remoteHint`, `contractHint`, `seniorityHint`, `locationSpec`,
   `timezoneOffsets` e `salary` servono a passare le informazioni che la fonte dà in forma strutturata.

3. **Registra** la classe nell'elenco `ADAPTERS` di `apps/api/src/sources/sources.module.ts` e aggiungi l'id a
   `SOURCE_IDS` e alla sezione `sources` dello schema in `packages/shared/src/settings/schema.ts` (abilitazione e
   intervallo di default). La fonte compare da sola nel Profilo e nella pagina Fonti.

4. **Scrivi il test** contro la fixture, senza rete, usando `testContext` da `adapters/testing.ts`:

   ```ts
   const { ctx } = testContext({ [ExampleAdapter.URL]: 'example.json' });
   const raws = await new ExampleAdapter().fetchJobs(ctx);
   ```

5. Esegui `pnpm check` nel container (vedi README) e aggiorna la tabella qui sopra.

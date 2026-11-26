# OliDuck — OliCyber Training Assistant

<p align="center">
  <img src="public/assets/brand/oliduck-logo-light.jpg" alt="Logo ufficiale OliDuck" width="240" height="230" />
</p>

OliDuck è un workspace didattico indipendente per prepararsi alle Olimpiadi Italiane di Cybersicurezza. Il nome unisce **OliCyber** e il concetto di **rubber duck debugging**.

L'interfaccia è un workspace a **tre aree**: a sinistra la navigazione con la cronologia chat persistente, al centro la dashboard **Training** e la **Challenge Library**, a destra l'**OliDuck Assistant**. La libreria e il tutor sono ridimensionabili con splitter trascinabile (22–72%), espansione, reset e persistenza della larghezza; il tutor è comprimibile e ripristinabile senza perdere la conversazione. Su schermi stretti la cronologia e la dashboard diventano overlay e la libreria/tutor restano a tab. I dettagli della challenge aprono un drawer in overlay.

Il tutor segue un metodo di hint progressivi: aiuta a comprendere il problema e a verificare il ragionamento senza fornire flag o soluzioni complete. L'AI è eseguita lato server tramite il binding `AI` di Workers AI, con modello predefinito `@cf/zai-org/glm-4.7-flash` e una KB didattica separata dalle challenge. Con il binding attivo le risposte sono trasmesse in streaming SSE. Le intenzioni didattiche sono classificate lato server; le risposte vengono renderizzate in Markdown sicuro senza `innerHTML`.

---

## Stato del progetto

Ramo attivo: `feature/oliduck-app`.

- [x] Workspace a tre aree (cronologia, Training, libreria/tutor) con splitter, min/max, reset, persistenza, tutor collassabile e responsive verificato via test strutturali.
- [x] Libreria v2 con card compatte in ordine ufficiale del dataset, ricerca per ID/titolo/descrizione/tag, filtri derivati dai dati, ordinamento alternativo, conteggio, stati personali, selezione e lista virtualizzata.
- [x] Drawer dei dettagli con testo non duplicato, hint, allegati testuali/binari/con errori, metadati reali e link originali solo se HTTPS.
- [x] Assistant con chat persistenti stile ChatGPT: **nuova chat sempre generale**, titoli automatici, rinomina, eliminazione con conferma, apertura della cronologia, separazione chat challenge/generali, **modalità generale** e conversazioni contestuali dedicate, selezione multipla di al massimo 6 challenge (`challengeIds`) con la challenge richiesta come contesto primario, contesto ricostruito **solo lato server**, streaming SSE cumulativo, errori con retry, annullamento sicuro e supporto IME.
- [x] Persistenza localStorage v2 con migrazione v1→v2, fallback in memoria e cancellazione dei dati.
- [x] Catalogo reale importato da export browser autorizzato (735 challenge su 738 scoperte; 3 record esclusi), con catalogo DEMO storico invariato per test e fallback.
- [x] Filtro per tag derivato dai dati, ricerca anche in hint e anteprime degli allegati testuali; le facet senza valori vengono nascoste.
- [x] KB didattica originale separata (`functions/data/teaching-kb.json`), con definizioni generali di concetti di informatica/cybersecurity; l'indice RAG dell'export browser è legacy e non usato dal tutor a runtime.
- [x] `GET /api/status` e `POST /api/chat` con validazione, limiti, classificazione deterministica delle intenzioni, rifiuto delle richieste esplicite di flag/soluzioni, chiarimenti senza chiamata al modello, rate limiting per isolato e gestione errori senza dettagli interni.
- [x] Estratto della consegna incollato dallo studente: opzionale, limitato e ripulito lato server, **associato alla chat e riutilizzato nei follow-up**, sempre trattato come dato non verificato. Il backend espone uno stato strutturato (`statementStatus`) distinto dal testo.
- [x] Comportamento tutor v2: hint progressivi a tre livelli, rifiuti insistenti variati ma con prefisso stabile, distinzione tra ragionamento ambiguo e richiesta di chiarimento, risposta empatica per il contesto personale senza allentare le protezioni.
- [x] Renderer Markdown lato client basato solo su DOM API: nessun `innerHTML` per contenuti del modello, escape letterali normalizzati e link solo HTTPS.
- [x] Logo ufficiale integrato in header, pannello tutor, chat iniziale, indicatore di caricamento, dialog Informazioni, README e documentazione; icone raster derivate senza alterare il file originale.
- [x] Modello AI centralizzato e verificato: `@cf/zai-org/glm-4.7-flash`, con `stream: true` lato server; resta disattivato senza binding effettivo.
- [x] Importatore offline per export ufficiali autorizzati e per export browser, con report di provenienza e failure non bloccanti.
- [x] Dataset di ricerca da fonti pubbliche: inventario, ID stabili, KB RAG autorizzata (oggi vuota), solution archive ristretto e import sanificato.
- [x] Test automatici (`node:test`) su backend, catalogo, import browser, dataset, store, UI e interazioni: **127 test passati**, inclusi i 12 casi comportamentali v2 in `tests/tutor-behavior-v2.test.mjs`, i test di branding/Markdown sicuro, il flusso contesto/consegna JSON+SSE (`tests/tutor-context-flow.test.mjs`) e la cronologia/chat persistenti (`tests/workspace-history.test.mjs`).

### Limiti noti

- **Catalogo non verificato**: l'export browser è stato ottenuto legalmente, ma la provenienza resta `verified: false` e lo stato è `imported-partial`; tre record non sono importabili.
- **Completezza non verificata**: 738 record scoperti, 735 importati; nessun totale ufficiale è stato fornito da una fonte autorizzata.
- **Binding dichiarato ma non verificato remote**: `wrangler.toml` contiene `[ai] binding = "AI"`; senza binding effettivo nell'ambiente il backend resta in modalità DEMO esplicita. Non è stato eseguito alcun deploy o controllo nella dashboard Cloudflare.
- **Tutela non esaustiva**: i controlli di input/output non garantiscono matematicamente l'assenza di soluzioni nelle risposte; la redaction è best-effort.
- **Streaming condizionato al binding**: senza `AI` l'handler restituisce JSON in modalità DEMO; con il binding attivo usa SSE cumulativo con redaction a finestra.
- **Rate limiting in memoria**: per isolato, non distribuito; in produzione affiancare WAF / Rate Limiting Rules.
- Nessun account, database o sincronizzazione cloud: i dati restano nel browser.

La ricerca approfondita sulle fonti pubbliche è in [`docs/PUBLIC-SOURCES-RESEARCH.md`](docs/PUBLIC-SOURCES-RESEARCH.md); l'architettura AI è descritta in [`docs/AI-ARCHITECTURE.md`](docs/AI-ARCHITECTURE.md), i comportamenti attesi del tutor in [`docs/TUTOR-BEHAVIOR.md`](docs/TUTOR-BEHAVIOR.md). Il manuale operativo completo è [`docs/OLIDUCK-HANDBOOK.md`](docs/OLIDUCK-HANDBOOK.md).

---

## Avvio locale

Richiede **Node.js 20+**.

```bash
npm install
npm test
npm run dev -- --port 8788
```

Apri `http://localhost:8788`. `npm run dev` avvia `wrangler pages dev public`: `public/` contiene i file statici e `functions/` viene rilevato come Pages Functions.

Per servire solo i file statici è sufficiente un qualsiasi server sulla cartella `public/`, ma in quel caso `/api/status` e `/api/chat` non esisteranno e l'assistente mostrerà un errore comprensibile.

---

## Struttura

```
├── public/
│   ├── index.html              # shell a tre aree (cronologia, training, libreria/tutor) + drawer
│   ├── favicon.ico             # icona raster derivata dal logo ufficiale
│   ├── favicon.svg             # fallback SVG storico
│   ├── assets/brand/           # logo ufficiale: originale, lockup, simbolo, icone
│   ├── styles/main.css         # design system, splitter, responsive, temi
│   ├── data/
│   │   ├── challenges.json     # catalogo DEMO storico, invariato per test e fallback
│   │   ├── olicyber-challenges.json # catalogo reale usato dall'UI
│   │   └── olicyber-import-report.json # provenienza e limiti dell'import
│   └── src/
│       ├── main.js             # orchestrazione
│       ├── store.js            # localStorage v2, migrazioni e preferenze
│       ├── catalog.js          # loader v2, facet, filtri, ordinamento
│       ├── library.js          # lista virtualizzata e controlli
│       ├── panels.js           # splitter, espansione, reset, tab mobile
│       ├── details.js          # drawer dei dettagli
│       ├── assistant.js        # chat persistenti, contesto challenge, SSE, annullamento
│       ├── history.js          # cronologia chat: nuova, apertura, rinomina, eliminazione
│       ├── training.js         # dashboard Training con dati reali del workspace
│       ├── markdown.js         # renderer Markdown sicuro con DOM API
│       ├── api.js              # client /api
│       ├── icons.js            # icone SVG
│       └── utils.js            # DOM, toast, conferme
├── functions/
│   ├── api/chat.js             # POST /api/chat
│   ├── api/status.js           # GET /api/status
│   ├── data/
│   │   ├── teaching-kb.json    # KB didattica originale, usata dal tutor
│   │   ├── teaching-kb-data.cjs # ponte CJS compatibile Wrangler 3/4
│   │   ├── rag-index.json      # indice RAG dell'export browser, legacy
│   │   └── rag-data.cjs        # ponte CJS per l'indice legacy
│   └── lib/
│       ├── model.js            # DEFAULT_MODEL (unico punto di verità)
│       ├── catalog.js          # catalogo authoritative lato server
│       ├── catalog-data.cjs    # ponte CJS per il catalogo reale
│       ├── rag.js              # accesso alla KB didattica lato server
│       ├── intent.js           # classificazione deterministica delle intenzioni
│       ├── system-prompt.js    # prompt con confine casuale + redaction
│       ├── validate.js         # validazione richieste, limiti e estratto consegna
│       ├── demo.js             # risposta simulata esplicita in modalità DEMO
│       └── rate-limit.js       # anti-abuso in memoria
├── scripts/
│   ├── import-browser-export.mjs # import del browser export sanitizzato
│   ├── import-catalog.mjs      # import autorizzato offline
│   ├── build-dataset.mjs       # dataset da fonti pubbliche locali
│   └── import-dataset.mjs      # catalogo applicativo sanificato
├── dataset-input/
│   ├── browser-import/         # tre export grezzi, ignorati da Git
│   ├── REPORT.md               # report finale delle fonti analizzate
│   ├── manifest.json           # inventario file-level e duplicati
│   ├── import-report.json      # provenienza e limiti del dataset
│   ├── catalog.json            # catalogo + KB + solution archive separati
│   ├── rag-index.json          # chunk RAG della sola knowledge base
│   └── derived/                # catalogo applicativo generato, non public/
├── tests/                      # 15 file node:test
├── docs/
│   ├── OLIDUCK-HANDBOOK.md
│   ├── AI-ARCHITECTURE.md
│   ├── CLOUDFLARE.md
│   ├── CATALOG-IMPORT.md
│   ├── DATASET.md
│   └── PUBLIC-SOURCES-RESEARCH.md
├── wrangler.toml
└── package.json
```

---

## API

### `GET /api/status`

```json
{
  "mode": "demo",
  "model": null,
  "streaming": false,
  "note": "Binding AI non configurato: il backend risponde in modalità DEMO.",
  "catalog": {
    "schemaVersion": 2,
    "status": "imported-partial",
    "verified": false,
    "imported": 735,
    "source": "OliCyber Training",
    "lastSync": "2026-11-26T09:35:38.941Z"
  }
}
```

Con AI configurata: `mode: "ai"`, `model` impostato e `streaming: true`. Lo status include inoltre `knowledge` (KB didattica attiva) e la chiave storica `rag`, che ora descrive la KB didattica e non i dati delle challenge; l'indice RAG dell'export browser non è più usato dal tutor a runtime.

### `POST /api/chat`

```json
{
  "challengeIds": ["olicyber-1"],
  "message": "Come posso iniziare?",
  "history": [{ "role": "user", "content": "Ho letto il testo" }],
  "statementExcerpt": "Testo della consegna incollato dallo studente (facoltativo)"
}
```

Sono accettati al massimo 6 ID. Per la conversazione generale non viene selezionata alcuna challenge (`challengeIds` vuoto o assente). Il client invia solo gli ID: descrizione, statement, hint, learningGoals, allegati, URL, stato e metadata sensibili non vengono mai inviati dal browser. `statementExcerpt` è un testo incollato dallo studente: non è una fonte verificata, viene limitato a 2.000 caratteri e ripulito lato server prima di entrare nel contesto come dato delimitato.

Il campo `challenge` **non è accettato** come fonte autorevole: se inviato viene ignorato. Il server ricostruisce il contesto leggendo il catalogo reale in `functions/lib/catalog.js` e usa solo la KB didattica `functions/data/teaching-kb.json` (`teaching-kb-data.cjs`). L'indice RAG dell'export browser è legacy e non viene usato a runtime.

Risposta (estratto):

```json
{
  "reply": "...",
  "mode": "demo",
  "challengeIds": ["olicyber-1"],
  "statementStatus": "user-provided",
  "catalogVerified": false,
  "contextMode": "single",
  "challengeCount": 1
}
```

oppure `mode: "ai"` con `model`. La risposta include `challengeIds`, `challengeId` (o `general`), `intent`, `statementProvided` e `sources` con soli metadati della KB; quando pertinenti include anche `statementMissing`, `needsClarification`, `hintStage`, `personalContext`, `support`, `statementStatus` (`unavailable` / `partial` / `user-provided` / `verified`), `catalogVerified`, `contextMode` (`general` / `single` / `multi`) e `challengeCount`. Lo stato della consegna è calcolato dal server e non dipende da testi non verificati inviati dal client. Non espone testo della KB, hint, flag o soluzioni. Le richieste esplicite di flag, soluzioni, writeup o payload vengono rifiutate prima della chiamata al modello, con `blocked: true`; le richieste ambigue ricevono `needsClarification: true` senza bloccare né chiamare il modello. La redaction dell'output è best-effort. Errori: `400` (validazione/challenge sconosciuta), `403` (origine non consentita), `413` (body > 16.000 byte), `415` (Content-Type errato), `429` (rate limit, con `Retry-After`), `502` (modello non disponibile), `503` (quota AI esaurita), `504` (timeout del modello).

Con il binding `AI` attivo la risposta può essere `text/event-stream`: ogni evento `data:` contiene un campo `reply` cumulativo e autorevole, più `mode`, `model`, `challengeIds`, `challengeId`, `sources` e, se applicabile, `blocked` o `error`. Il client accetta anche il vecchio campo `token` come delta. La redazione e il rilevamento di flag/procedure vengono applicati al testo accumulato lato server; gli ultimi 64 caratteri restano in buffer fino alla chiusura del blocco, così un flag diviso tra due chunk non viene trasmesso. Timeout assoluto: 20 secondi per l'intera generazione.

Limiti: messaggio 4.000 caratteri, cronologia 12 messaggi / 8.000 caratteri, body 16.000 byte, massimo 6 challenge e `max_completion_tokens: 700`. Il ragionamento interno del modello è disattivato (`chat_template_kwargs.enable_thinking: false`) per non consumare il budget di output né esporlo allo studente. Il contesto e la cronologia sono inseriti in messaggi `user` separati da un confine casuale generato per ogni richiesta: non possono modificare il system prompt. I controlli non garantiscono matematicamente l'assenza di soluzioni.

---

## Dati locali

Chiave: `oliduck:state`, `version: 2` (invariato; i nuovi campi sono opzionali e retrocompatibili).

```json
{
  "version": 2,
  "statuses": { "olicyber-1": "in-progress" },
  "conversations": {
    "general": [{ "id": "...", "role": "user", "content": "..." }],
    "ctx:olicyber-1": [],
    "chat:1764160000000-a1b2c3": []
  },
  "conversationMeta": {
    "chat:1764160000000-a1b2c3": {
      "title": "Come inizio?",
      "kind": "challenge",
      "challengeIds": ["olicyber-1"],
      "statementExcerpt": "Estratto incollato dallo studente"
    }
  },
  "activeConversation": "chat:1764160000000-a1b2c3",
  "selectedChallengeIds": ["olicyber-1"],
  "favorites": [],
  "preferences": {
    "theme": "light",
    "panelWidth": 40,
    "activePanel": "assistant",
    "assistantCollapsed": false,
    "filters": {
      "query": "", "category": "all", "difficulty": "all", "edition": "all",
      "path": "all", "tag": "all", "status": "all", "sort": "catalog"
    }
  }
}
```

Dati del catalogo, dati personali, conversazioni e preferenze restano separati. Aggiornare il catalogo non cancella progressi o chat. Le chiavi storiche `general` e `ctx:<ids>` continuano a funzionare; le nuove chat esplicite usano `chat:<timestamp>-<random>`. Un **nuova chat** non eredita mai il contesto challenge. I titoli derivano dal primo messaggio e possono essere rinominati. Se `localStorage` non è disponibile l'app resta usabile in memoria e lo segnala nelle impostazioni.

---

## Catalogo e importazione

L'UI usa `public/data/olicyber-challenges.json`: 735 challenge importate da export browser ottenuti legalmente (738 record scoperti, 3 esclusi). `public/data/challenges.json` resta il catalogo DEMO storico di 7 record, invariato per test e fallback. Ogni record conserva `provenance` (`source`, `sourceUrl`, `verified`), campi origine (`originalId`, `edition`, `path`, `score`, `author`, `state`, `available`) e allegati separati dal testo.

L'ordinamento predefinito `catalog` conserva l'ordine dell'array ufficiale; `original-id` è l'alternativa deterministica. Il click sulla card apre il drawer dei dettagli, mentre il pulsante **Chat** aggiunge la challenge al contesto dell'assistente come **contesto primario**; lo stesso vale per **Chiedi a OliDuck** dal drawer. La selezione multipla è limitata a 6 challenge e la challenge più vecchia viene sostituita quando si supera il limite. Difficoltà, edizione, percorso e data di pubblicazione non sono presenti nel catalogo reale: i controlli correlati vengono nascosti e nessun campo vuoto viene mostrato.

Per rigenerare in modo deterministico catalogo, report e indice RAG dai tre export browser grezzi:

```bash
npm run dataset:browser-import
```

Lo script legge solo `dataset-input/browser-import/oliduck-dataset.json`, `oliduck-rag.json` e `oliduck-failed.json` (file grezzi ignorati da Git) e produce:

- `public/data/olicyber-challenges.json` — catalogo pubblico sanificato, usato dall'UI;
- `public/data/olicyber-import-report.json` — conteggi, SHA-256 dei sorgenti e ID esclusi;
- `functions/data/rag-index.json` — 1189 chunk RAG, serviti solo lato server; **legacy**, non più usati dal tutor a runtime;
- `dataset-input/derived/browser-import/import-failures.json` — failure non bloccanti.

Non vengono pubblicati token, cookie, flag, allegati Base64 né URL interni autenticati. I chunk RAG non sono esposti come file statico. Il tutor usa solo la KB didattica separata `functions/data/teaching-kb.json`: non restituisce snippet delle challenge. Dettagli: [`docs/CATALOG-IMPORT.md`](docs/CATALOG-IMPORT.md) e [`docs/AI-ARCHITECTURE.md`](docs/AI-ARCHITECTURE.md).

Per importare un diverso export ottenuto legalmente dall'utente:

```bash
node scripts/import-catalog.mjs \
  --file /percorso/export-autorizzato.json \
  --expected-total 123 \
  --source-name "Export admin OliCyber 2026"
```

L'importatore non effettua richieste di rete, non legge token/cookie/sessioni, rimuove campi sensibili (`flag`, `solution`, `writeup`) e interrompe l'import se rileva pattern di flag.

Il dataset di ricerca derivato dalle fonti pubbliche locali è descritto in [`docs/DATASET.md`](docs/DATASET.md):

```bash
npm run dataset:build   # rigenera dataset-input/{REPORT,manifest,catalog,rag-index}
npm run dataset:import  # catalogo sanificato in dataset-input/derived/, non public/
```

Le tre sezioni (`Challenge Catalog`, `Learning Knowledge Base`, `Solution Archive`) restano separate. Solo il catalogo sanificato può essere importato nell'app, sempre con stato `unverified-derived` finché non esiste un export autorizzato.

---

## Sicurezza

- Nessuna API key, token o segreto nel repository o nel frontend: il provider AI è chiamato solo dal Pages Function tramite il binding `AI`.
- La KB didattica e l'indice RAG legacy restano in `functions/data/`, non in `public/`; gli snippet non vengono restituiti alle API.
- Nessuna conversazione salvata server-side.
- Validazione di tutti i campi (messaggio 4.000 caratteri, cronologia 12 messaggi / 8.000 caratteri, body 16.000 byte, massimo 6 challenge), controllo `Origin`, rate limiting per isolato e header `no-store` / `nosniff`.
- Classificazione deterministica lato server: rifiuto solo delle richieste esplicite di flag, soluzioni, writeup o payload; le domande teoriche con termini come `challenge`, `HTTP`, `token`, `exploit`, `flag` o `risolvere` restano ammesse.
- System prompt con confine casuale per richiesta; dati non attendibili delimitati, incluso l'estratto incollato; redaction best-effort dell'output, applicata anche durante lo streaming con buffer di sicurezza sui caratteri finali.
- Markdown del modello renderizzato solo con DOM API, senza `innerHTML`; link accettati solo HTTPS e contenuto ostile mantenuto come testo.
- I writeup ufficiali contengono soluzioni e flag reali: non sono usati come catalogo né come contesto AI.
- I controlli non garantiscono matematicamente l'assenza di soluzioni e il rate limiter in memoria non è distribuito: in produzione aggiungere Rate Limiting Rules / WAF. Dettagli in [`docs/AI-ARCHITECTURE.md`](docs/AI-ARCHITECTURE.md).

---

## Comandi

```bash
npm test                 # test automatici
npm run dataset:browser-import # catalogo reale e indice RAG da export browser
npm run dataset:build    # dataset da fonti pubbliche locali
npm run dataset:import   # catalogo applicativo sanificato
npm run dev           # sviluppo con Pages Functions
npm run deploy        # deploy Cloudflare Pages (richiede autenticazione)
```

Configurazione Cloudflare, binding AI e troubleshooting: [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md). Architettura AI e verifica manuale: [`docs/AI-ARCHITECTURE.md`](docs/AI-ARCHITECTURE.md).

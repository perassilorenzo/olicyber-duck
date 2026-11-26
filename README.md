# OliDuck — OliCyber Training Assistant

OliDuck è un workspace didattico indipendente per prepararsi alle Olimpiadi Italiane di Cybersicurezza. Il nome unisce **OliCyber** e il concetto di **rubber duck debugging**.

L'interfaccia ha **esattamente due pannelli**: la **Challenge Library** (~40%) e l'**OliDuck Assistant** (~60%). Un splitter trascinabile permette di ridimensionarle (22–72%), con espansione, reset, persistenza della larghezza e selezione a tab su mobile. I dettagli della challenge aprono un drawer in overlay: non esiste una terza colonna e la chat resta sempre utilizzabile.

Il tutor segue un metodo di hint progressivi: aiuta a comprendere il problema e a verificare il ragionamento senza fornire flag o soluzioni complete. L'AI è eseguita lato server tramite il binding `AI` di Workers AI, con modello predefinito `@cf/zai-org/glm-4.7-flash` e una KB didattica separata dalle challenge. Con il binding attivo le risposte sono trasmesse in streaming SSE.

---

## Stato del progetto

Ramo attivo: `feature/oliduck-app`.

- [x] Workspace a due pannelli con splitter, min/max, reset, persistenza e responsive a due tab.
- [x] Libreria v2 con card compatte in ordine ufficiale del dataset, ricerca per ID/titolo/descrizione/tag, filtri derivati dai dati, ordinamento alternativo, conteggio, stati personali, selezione e lista virtualizzata.
- [x] Drawer dei dettagli con testo non duplicato, hint, allegati testuali/binari/con errori, metadati reali e link originali solo se HTTPS.
- [x] Assistant con **modalità generale** e conversazioni separate per challenge, selezione multipla di al massimo 6 challenge (`challengeIds`), contesto ricostruito **solo lato server**, streaming SSE cumulativo, errori con retry, annullamento sicuro e supporto IME.
- [x] Persistenza localStorage v2 con migrazione v1→v2, fallback in memoria e cancellazione dei dati.
- [x] Catalogo reale importato da export browser autorizzato (735 challenge su 738 scoperte; 3 record esclusi), con catalogo DEMO storico invariato per test e fallback.
- [x] Filtro per tag derivato dai dati, ricerca anche in hint e anteprime degli allegati testuali; le facet senza valori vengono nascoste.
- [x] KB didattica originale separata (`functions/data/teaching-kb.json`), con definizioni generali di concetti di informatica/cybersecurity; l'indice RAG dell'export browser è legacy e non usato dal tutor a runtime.
- [x] `GET /api/status` e `POST /api/chat` con validazione, limiti, rifiuto deterministico delle richieste di flag/soluzioni, rate limiting per isolato e gestione errori senza esporre dettagli interni.
- [x] Modello AI centralizzato e verificato: `@cf/zai-org/glm-4.7-flash`, con `stream: true` lato server; resta disattivato senza binding.
- [x] Importatore offline per export ufficiali autorizzati e per export browser, con report di provenienza e failure non bloccanti.
- [x] Dataset di ricerca da fonti pubbliche: inventario, ID stabili, KB RAG autorizzata (oggi vuota), solution archive ristretto e import sanificato.
- [x] Test automatici (`node:test`) su backend, catalogo, import browser, dataset, store, UI e interazioni.

### Limiti noti

- **Catalogo non verificato**: l'export browser è stato ottenuto legalmente, ma la provenienza resta `verified: false` e lo stato è `imported-partial`; tre record non sono importabili.
- **Completezza non verificata**: 738 record scoperti, 735 importati; nessun totale ufficiale è stato fornito da una fonte autorizzata.
- **Binding opzionale**: senza binding Workers AI il backend resta in modalità DEMO esplicita; il binding non si attiva automaticamente.
- **Tutela non esaustiva**: i controlli di input/output non garantiscono matematicamente l'assenza di soluzioni nelle risposte; la redaction è best-effort.
- **Streaming condizionato al binding**: senza `AI` l'handler restituisce JSON in modalità DEMO; con il binding attivo usa SSE cumulativo con redaction a finestra.
- **Rate limiting in memoria**: per isolato, non distribuito; in produzione affiancare WAF / Rate Limiting Rules.
- Nessun account, database o sincronizzazione cloud: i dati restano nel browser.

La ricerca approfondita sulle fonti pubbliche è in [`docs/PUBLIC-SOURCES-RESEARCH.md`](docs/PUBLIC-SOURCES-RESEARCH.md); l'architettura AI è descritta in [`docs/AI-ARCHITECTURE.md`](docs/AI-ARCHITECTURE.md).

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
│   ├── index.html              # shell a due pannelli + drawer
│   ├── favicon.svg
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
│       ├── assistant.js        # chat generale/contestuale, SSE, annullamento
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
│       ├── system-prompt.js    # prompt con confine casuale + redaction
│       ├── validate.js         # validazione richieste, limiti e rifiuti deterministici
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
├── tests/                      # 12 file node:test
├── docs/
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
  "history": [{ "role": "user", "content": "Ho letto il testo" }]
}
```

Sono accettati al massimo 6 ID. Per la conversazione generale non viene selezionata alcuna challenge (`challengeIds` vuoto o assente). Il client invia solo gli ID: descrizione, statement, hint, learningGoals, allegati, URL, stato e metadata sensibili non vengono mai inviati dal browser.

Il campo `challenge` **non è accettato** come fonte autorevole: se inviato viene ignorato. Il server ricostruisce il contesto leggendo il catalogo reale in `functions/lib/catalog.js` e usa solo la KB didattica `functions/data/teaching-kb.json` (`teaching-kb-data.cjs`). L'indice RAG dell'export browser è legacy e non viene usato a runtime.

Risposta (estratto):

```json
{
  "reply": "...",
  "mode": "demo"
}
```

oppure `mode: "ai"` con `model`. La risposta include `challengeIds`, `challengeId` (o `general`) e `sources` con soli metadati della KB; non espone testo della KB, hint, flag o soluzioni. Le richieste che chiedono flag, soluzioni, writeup o payload vengono rifiutate in modo deterministico prima della chiamata al modello, con `blocked: true`. La redaction dell'output è best-effort. Errori: `400` (validazione/challenge sconosciuta), `403` (origine non consentita), `413` (body > 16.000 byte), `415` (Content-Type errato), `429` (rate limit, con `Retry-After`), `502` (modello non disponibile), `503` (quota AI esaurita), `504` (timeout del modello).

Con il binding `AI` attivo la risposta può essere `text/event-stream`: ogni evento `data:` contiene un campo `reply` cumulativo e autorevole, più `mode`, `model`, `challengeIds`, `challengeId`, `sources` e, se applicabile, `blocked` o `error`. Il client accetta anche il vecchio campo `token` come delta. La redazione e il rilevamento di flag/procedure vengono applicati al testo accumulato lato server; gli ultimi 64 caratteri restano in buffer fino alla chiusura del blocco, così un flag diviso tra due chunk non viene trasmesso. Timeout assoluto: 20 secondi per l'intera generazione.

Limiti: messaggio 4.000 caratteri, cronologia 12 messaggi / 8.000 caratteri, body 16.000 byte, massimo 6 challenge e `max_completion_tokens: 700`. Il ragionamento interno del modello è disattivato (`chat_template_kwargs.enable_thinking: false`) per non consumare il budget di output né esporlo allo studente. Il contesto e la cronologia sono inseriti in messaggi `user` separati da un confine casuale generato per ogni richiesta: non possono modificare il system prompt. I controlli non garantiscono matematicamente l'assenza di soluzioni.

---

## Dati locali

Chiave: `oliduck:state`, `version: 2`.

```json
{
  "version": 2,
  "statuses": { "olicyber-1": "in-progress" },
  "conversations": {
    "general": [{ "id": "...", "role": "user", "content": "..." }],
    "olicyber-1": []
  },
  "selectedChallengeId": "olicyber-1",
  "preferences": {
    "theme": "light",
    "panelWidth": 40,
    "activePanel": "assistant",
    "filters": {
      "query": "", "category": "all", "difficulty": "all", "edition": "all",
      "path": "all", "tag": "all", "status": "all", "sort": "catalog"
    }
  }
}
```

Dati del catalogo, dati personali, conversazioni e preferenze restano separati. Aggiornare il catalogo non cancella progressi o chat. Se `localStorage` non è disponibile l'app resta usabile in memoria e lo segnala nelle impostazioni.

---

## Catalogo e importazione

L'UI usa `public/data/olicyber-challenges.json`: 735 challenge importate da export browser ottenuti legalmente (738 record scoperti, 3 esclusi). `public/data/challenges.json` resta il catalogo DEMO storico di 7 record, invariato per test e fallback. Ogni record conserva `provenance` (`source`, `sourceUrl`, `verified`), campi origine (`originalId`, `edition`, `path`, `score`, `author`, `state`, `available`) e allegati separati dal testo.

L'ordinamento predefinito `catalog` conserva l'ordine dell'array ufficiale; `original-id` è l'alternativa deterministica. Il click sulla card apre il drawer dei dettagli, mentre il pulsante **Chat** aggiunge la challenge al contesto dell'assistente; la selezione multipla è limitata a 6 challenge. Difficoltà, edizione, percorso e data di pubblicazione non sono presenti nel catalogo reale: i controlli correlati vengono nascosti e nessun campo vuoto viene mostrato.

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
- Rifiuto deterministico lato server delle richieste di flag, soluzioni, writeup o payload prima della chiamata al modello.
- System prompt con confine casuale per richiesta; dati non attendibili delimitati; redaction best-effort dell'output, applicata anche durante lo streaming con buffer di sicurezza sui caratteri finali.
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

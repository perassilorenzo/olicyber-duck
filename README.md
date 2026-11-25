# OliDuck — OliCyber Training Assistant

OliDuck è un workspace didattico indipendente per prepararsi alle Olimpiadi Italiane di Cybersicurezza. Il nome unisce **OliCyber** e il concetto di **rubber duck debugging**.

L'interfaccia ha **esattamente due pannelli**: la **Challenge Library** (~40%) e l'**OliDuck Assistant** (~60%). Un splitter trascinabile permette di ridimensionarle (22–72%), con espansione, reset, persistenza della larghezza e selezione a tab su mobile. I dettagli della challenge aprono un drawer in overlay: non esiste una terza colonna e la chat resta sempre utilizzabile.

Il tutor segue un metodo di hint progressivi: aiuta a comprendere il problema e a verificare il ragionamento senza fornire flag o soluzioni complete.

---

## Stato del progetto

Ramo attivo: `feature/oliduck-app`.

- [x] Workspace a due pannelli con splitter, min/max, reset, persistenza e responsive a due tab.
- [x] Libreria v2 con ricerca, filtri derivati dai dati reali del catalogo, ordinamento, conteggio, stati personali, selezione e lista virtualizzata.
- [x] Drawer dei dettagli con testo, provenienza, link originali e allegati eventuali.
- [x] Assistant con **modalità generale** e conversazioni separate per challenge, contesto ricostruito **solo lato server**, streaming SSE cumulativo, errori con retry, annullamento sicuro e supporto IME.
- [x] Persistenza localStorage v2 con migrazione v1→v2, fallback in memoria e cancellazione dei dati.
- [x] Catalogo statico v2 con 7 challenge **DEMO** esplicitamente contrassegnate, nessun flag e nessun link inventato.
- [x] `GET /api/status` e `POST /api/chat` con validazione, limiti, rate limiting per isolato e gestione errori senza esporre dettagli interni.
- [x] Modello AI centralizzato e verificato: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- [x] Importatore offline per export ufficiali autorizzati, con report di provenienza.
- [x] Dataset di ricerca da fonti pubbliche: inventario, ID stabili, KB RAG, solution archive ristretto e import sanificato.
- [x] 39 test automatici (`node:test`) su backend, catalogo, import, dataset, store, UI e interazioni.

### Limiti noti

- **Catalogo non ufficiale**: le challenge incluse sono esempi didattici; `status: "unverified-demo"`.
- **Completezza non verificabile**: il numero totale ufficiale delle challenge non è pubblico e le API del portale richiedono login.
- **Binding Workers AI da configurare**: senza di esso il backend risponde in modalità DEMO esplicita.
- **Streaming lato server**: il client supporta SSE cumulativo; l'handler attuale restituisce JSON completo.
- **Rate limiting in memoria**: per isolato; in produzione affiancare WAF / Rate Limiting Rules.
- Nessun account, database o sincronizzazione cloud: i dati restano nel browser.

La ricerca approfondita sulle fonti pubbliche è in [`docs/PUBLIC-SOURCES-RESEARCH.md`](docs/PUBLIC-SOURCES-RESEARCH.md).

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
│   │   ├── challenges.json     # catalogo statico v2, separato dai dati personali
│   │   └── import-report.json  # provenienza e limiti del catalogo
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
│   └── lib/
│       ├── model.js            # DEFAULT_MODEL (unico punto di verità)
│       ├── catalog.js          # catalogo authoritative lato server
│       ├── catalog-data.cjs    # ponte CJS per import JSON compatibile Wrangler 3/4
│       ├── system-prompt.js    # prompt statico + confine casuale + redaction
│       ├── validate.js         # validazione richieste
│       ├── demo.js             # risposta simulata esplicita
│       └── rate-limit.js       # anti-abuso in memoria
├── scripts/
│   ├── import-catalog.mjs      # import autorizzato offline
│   ├── build-dataset.mjs       # dataset da fonti pubbliche locali
│   └── import-dataset.mjs      # catalogo applicativo sanificato
├── dataset-input/
│   ├── REPORT.md               # report finale delle fonti analizzate
│   ├── manifest.json           # inventario file-level e duplicati
│   ├── import-report.json      # provenienza e limiti del dataset
│   ├── catalog.json            # catalogo + KB + solution archive separati
│   ├── rag-index.json          # chunk RAG della sola knowledge base
│   └── derived/                # catalogo applicativo generato, non public/
├── tests/                      # 6 file node:test
├── docs/
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
  "note": "Binding AI non configurato: il backend risponde in modalità DEMO.",
  "catalog": {
    "schemaVersion": 2,
    "status": "unverified-demo",
    "verified": false,
    "imported": 7,
    "source": "OliDuck DEMO (non ufficiale)",
    "lastSync": null
  }
}
```

Con AI configurata: `mode: "ai"` e `model` impostato.

### `POST /api/chat`

```json
{
  "challengeId": "demo-web-01",
  "message": "Come posso iniziare?",
  "history": [{ "role": "user", "content": "Ho letto il testo" }]
}
```

Per la conversazione generale usare `"challengeId": "general"`.

Il campo `challenge` **non è accettato**: se inviato viene ignorato. Il server ricostruisce il contesto leggendo il catalogo in `functions/lib/catalog.js`.

Risposta:

```json
{ "reply": "...", "mode": "demo", "challengeId": "demo-web-01" }
```

oppure `mode: "ai"` con `model`. Errori: `400` (validazione/challenge sconosciuta), `403` (origine non consentita), `413` (body > 16.000 byte), `415` (Content-Type errato), `429` (rate limit, con `Retry-After`), `502` (modello non disponibile).

Limiti: messaggio 4.000 caratteri, cronologia 12 messaggi / 8.000 caratteri. Il contesto e la cronologia sono inseriti in messaggi `user` separati da un confine casuale generato per ogni richiesta: non possono modificare il system prompt.

---

## Dati locali

Chiave: `oliduck:state`, `version: 2`.

```json
{
  "version": 2,
  "statuses": { "demo-web-01": "in-progress" },
  "conversations": {
    "general": [{ "id": "...", "role": "user", "content": "..." }],
    "demo-web-01": []
  },
  "selectedChallengeId": "demo-web-01",
  "preferences": {
    "theme": "light",
    "panelWidth": 40,
    "activePanel": "assistant",
    "filters": {
      "query": "", "category": "all", "difficulty": "all", "edition": "all",
      "path": "all", "status": "all", "sort": "title-asc"
    }
  }
}
```

Dati ufficiali, dati personali, conversazioni e preferenze restano separati. Aggiornare `challenges.json` non cancella progressi o chat. Se `localStorage` non è disponibile l'app resta usabile in memoria e lo segnala nelle impostazioni.

---

## Catalogo e importazione

Il catalogo v2 è `public/data/challenges.json`. Ogni record conserva `provenance` (`source`, `sourceUrl`, `verified`), campi origine (`originalId`, `edition`, `path`, `score`, `author`, `state`, `available`) e allegati separati dal testo.

Per importare un export ottenuto legalmente dall'utente:

```bash
node scripts/import-catalog.mjs \
  --file /percorso/export-autorizzato.json \
  --expected-total 123 \
  --source-name "Export admin OliCyber 2026"
```

L'importatore non effettua richieste di rete, non legge token/cookie/sessioni, rimuove campi sensibili (`flag`, `solution`, `writeup`) e interrompe l'import se rileva pattern di flag. Dettagli: [`docs/CATALOG-IMPORT.md`](docs/CATALOG-IMPORT.md).

Il dataset di ricerca derivato dalle fonti pubbliche locali è descritto in [`docs/DATASET.md`](docs/DATASET.md):

```bash
npm run dataset:build   # rigenera dataset-input/{REPORT,manifest,catalog,rag-index}
npm run dataset:import  # catalogo sanificato in dataset-input/derived/, non public/
```

Le tre sezioni (`Challenge Catalog`, `Learning Knowledge Base`, `Solution Archive`) restano separate. Solo il catalogo sanificato può essere importato nell'app, sempre con stato `unverified-derived` finché non esiste un export autorizzato.

---

## Sicurezza

- Nessuna API key, token o segreto nel frontend: il provider AI è chiamato solo dal Pages Function.
- Nessuna conversazione salvata server-side.
- Validazione di tutti i campi, limiti byte reali, controllo `Origin`, rate limiting per IP (hash SHA-256) e header `no-store` / `nosniff`.
- System prompt statico lato server; dati non attendibili delimitati; redaction best-effort dell'output.
- I writeup ufficiali contengono soluzioni e flag reali: non sono usati come catalogo né come contesto AI.

---

## Comandi

```bash
npm test              # test automatici
npm run dataset:build # dataset da fonti pubbliche locali
npm run dataset:import # catalogo applicativo sanificato
npm run dev           # sviluppo con Pages Functions
npm run deploy        # deploy Cloudflare Pages (richiede autenticazione)
```

Configurazione Cloudflare, binding AI e troubleshooting: [`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md).

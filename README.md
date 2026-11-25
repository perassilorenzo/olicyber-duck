# OliDuck — OliCyber Training Assistant

OliDuck è una piattaforma web indipendente per allenarsi e studiare in preparazione alle Olimpiadi Italiane di Cybersicurezza (OliCyber). Il nome unisce **OliCyber** e il concetto di **rubber duck debugging**.

Il prodotto non è un chatbot generico: è un workspace in cui una **Challenge Library** è integrata con un **tutor AI contestuale**. Ogni conversazione è associata alla challenge selezionata e segue un metodo di hint progressivi: lo studente viene guidato senza ricevere subito flag o soluzioni complete.

L'interfaccia riprende la famiglia cromatica e il linguaggio visivo del portale OliCyber (blu `#1b4778` / `#1e5ea4`, superfici chiare, accento rosso `#f33c3c`, card sobrie, tipografia sans-serif), con un'identità originale:logo e favicon a forma di anatra con richiamo alla cybersecurity.

---

## Stato del progetto

Repository inizialmente vuoto: l'applicazione è stata creata da zero con HTML, CSS e JavaScript vanilla (ES Modules), senza framework o dipendenze frontend. Il backend è implementato con Cloudflare Pages Functions e usa Workers AI quando il binding è configurato.

### Funzionalità implementate e verificate

- [x] Header con logo originale, navigazione, stato assistente, impostazioni e informazioni.
- [x] Challenge Library con ricerca, filtri per categoria/difficoltà, conteggio, stati e selezione.
- [x] Challenge Workspace con testo, obiettivi, fonti, allegati eventuali e cambio stato (Da fare → In corso → Completata).
- [x] Pannello assistente con chat per challenge, cronologia, invio con Invio, stato di generazione, errori con retry, cancellazione con conferma e riduzione/espansione.
- [x] Messaggio iniziale contestuale e messaggi separati per ID challenge.
- [x] Persistenza localStorage versionata (stati, conversazioni, preferenze, ultima challenge selezionata) con fallback in memoria e cancellazione dei dati.
- [x] Catalogo JSON statico con 7 challenge **DEMO** esplicitamente contrassegnate, nessun flag e nessun link inventato.
- [x] `GET /api/status` e `POST /api/chat` con validazione, limiti, rate limiting per isolato, protezione dell'origine e gestione errori.
- [x] System prompt dedicato lato server con regole didattiche e anti-divulgazione.
- [x] Modalità DEMO esplicita quando il binding AI assente; mai presentata come risposta AI reale.
- [x] Client API pronto per streaming SSE (callback token già integrato nell'UI).
- [x] Design responsive a tre pannelli su desktop e a tab su schermi piccoli, temi chiaro/scuro, focus visibili, `aria-live`, dialog accessibili, `prefers-reduced-motion`.
- [x] 15 test automatici (`node:test`) su store, catalogo, validazione, prompt, rate limit, handler backend e flusso UI.

### Ancora da configurare / limiti noti

- [ ] **Binding Workers AI** e (opzionale) `AI_MODEL`: senza di essi il backend resta in modalità DEMO. Vedi [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).
- [ ] **Dataset reale**: le challenge incluse sono esempi didattici. Non sono state inventate challenge, flag o URL ufficiali.
- [ ] **Streaming effettivo lato server**: il client lo supporta, ma il backend restituisce oggi JSON completo.
- [ ] **Rate limiting distribuito**: quello attuale è in memoria per isolato; in produzione usare anche Cloudflare WAF / Rate Limiting Rules.
- [ ] Nessun login, database, sincronizzazione cloud o statistiche: scelta deliberata. I dati restano nel browser.

---

## Avvio locale

Richiede **Node.js 20+**.

```bash
git clone https://github.com/perassilorenzo/olicyber-duck.git
cd olicyber-duck
npm install
npm test
npm run dev
```

Apri `http://localhost:8788`. `npm run dev` avvia `wrangler pages dev public`: la directory `public/` contiene i file statici e la cartella `functions/` viene rilevata automaticamente come Pages Functions.

Se vuoi solo servire i file statici senza backend puoi usare un qualsiasi server statico sulla cartella `public/`, ma in quel caso `/api/chat` e `/api/status` non esisteranno e l'assistente mostrerà un errore comprensibile.

---

## Struttura

```
├── public/
│   ├── index.html              # shell dell'applicazione
│   ├── favicon.svg             # identità OliDuck
│   ├── styles/main.css         # design system, layout, responsive
│   ├── data/challenges.json    # catalogo statico separato dai dati personali
│   └── src/
│       ├── main.js             # orchestrazione
│       ├── store.js            # localStorage versionato e fallback
│       ├── catalog.js          # caricamento e filtri
│       ├── library.js          # pannello sinistro
│       ├── workspace.js        # pannello centrale
│       ├── assistant.js        # pannello destro
│       ├── api.js              # client /api con supporto SSE
│       ├── icons.js            # icone SVG
│       └── utils.js            # DOM, toast, conferme
├── functions/
│   ├── api/chat.js             # POST /api/chat
│   ├── api/status.js           # GET /api/status
│   └── lib/
│       ├── system-prompt.js    # prompt del tutor (solo server)
│       ├── validate.js         # validazione richieste
│       ├── demo.js             # risposta simulata esplicita
│       └── rate-limit.js       # anti-abuso in memoria
├── tests/                      # test node:test
├── wrangler.toml
└── docs/CLOUDFLARE.md
```

---

## API

### `GET /api/status`

```json
{ "mode": "demo", "model": null, "note": "Binding AI non configurato: il backend risponde in modalità DEMO." }
```

Con AI configurata: `mode: "ai"` e `model` impostato.

### `POST /api/chat`

```json
{
  "challengeId": "demo-web-01",
  "challenge": {
    "id": "demo-web-01", "title": "...", "category": "Web", "difficulty": "Facile",
    "description": "...", "statement": "...", "tags": [], "learningGoals": [],
    "hintTopics": [], "demo": true
  },
  "message": "Come posso iniziare?",
  "history": [{ "role": "user", "content": "..." }]
}
```

Risposta:

```json
{ "reply": "...", "mode": "demo" }
```

oppure `mode: "ai"` con `model`. Errori: `400` (validazione), `403` (origine non consentita), `413` (body troppo grande), `429` (troppe richieste, con `Retry-After`), `502` (modello non disponibile).

Limiti: body 16 KB, messaggio 4.000 caratteri, cronologia 12 messaggi / 8.000 caratteri, contesto challenge 6.000 caratteri. Il contesto inviato dal client viene trattato come **dato non attendibile** e inserito delimitato nel prompt: non può modificare le istruzioni del sistema.

---

## Dati locali

Chiave: `oliduck:state`, `version: 1`.

```json
{
  "version": 1,
  "statuses": { "demo-web-01": "in-progress" },
  "conversations": { "demo-web-01": [{ "id": "...", "role": "user", "content": "...", "createdAt": "..." }] },
  "selectedChallengeId": "demo-web-01",
  "preferences": { "theme": "light", "assistantCollapsed": false, "mobileView": "workspace", "filters": {} }
}
```

La normalizzazione rimuove dati malformati; le migrazioni future si aggiungono in `store.js` (`migrate`). Se `localStorage` non è disponibile l'app resta usabile in memoria e lo segnala nelle impostazioni. La cancellazione totale richiede conferma e rimuove la chiave. **I dati non si sincronizzano tra browser o dispositivi.**

---

## Catalogo delle challenge

Il catalogo è `public/data/challenges.json`, separato dai dati personali. Campi: `id`, `title`, `category`, `difficulty`, `description`, `statement`, `source`, `externalUrl`, `tags`, `learningGoals`, `hintTopics`, `demo`. Per importare challenge reali: aggiungere voci con `demo: false`, `source` verificata ed `externalUrl` valido; non inserire flag nei dati dimostrativi. La UI mostra automaticamente il badge DEMO e i link esterni solo se presenti.

---

## Sicurezza

- Nessuna API key, token o segreto nel frontend: la comunicazione con il provider AI avviene solo nel Pages Function.
- Nessun salvataggio server-side delle conversazioni.
- Validazione di tutti i campi, limiti di dimensione, controllo `Origin`, rate limiting per IP (hash SHA-256) e header `no-store`/`nosniff`.
- Il system prompt è in `functions/lib/system-prompt.js`, fuori dal bundle frontend.

---

## Comandi

```bash
npm test        # test automatici
npm run dev     # sviluppo locale con Pages Functions
npm run deploy  # deploy su Cloudflare Pages (richiede autenticazione wrangler)
```

Per la configurazione Cloudflare completa, binding AI, variabili, deploy e troubleshooting: [docs/CLOUDFLARE.md](docs/CLOUDFLARE.md).

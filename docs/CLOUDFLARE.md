# Guida alla configurazione Cloudflare

OliDuck usa **Cloudflare Pages**: file statici in `public/`, backend in `functions/`, modello tramite il binding server-side `AI` di **Workers AI**. Non esistono API key nel repository o nel frontend.

L'architettura completa del tutor, i dati inviati al modello e la verifica in browser sono descritti in [`AI-ARCHITECTURE.md`](AI-ARCHITECTURE.md).

## 1. Sviluppo locale

```bash
npm install
npm test
npm run dev -- --port 8788
```

Apri `http://localhost:8788`. Senza binding AI, `GET /api/status` restituisce `mode: "demo"` e `POST /api/chat` restituisce una risposta simulata **etichettata come DEMO**. Non serve alcuna API key per questa modalità. Il tutor usa la KB didattica originale in `functions/data/teaching-kb.json`: l'indice RAG dell'export browser è legacy e non viene usato a runtime.

## 2. Modello predefinito e binding AI

Il modello predefinito, centralizzato in `functions/lib/model.js`, è:

```
@cf/zai-org/glm-4.7-flash
```

È GLM-4.7-Flash di Zhipu AI. Secondo la [pagina ufficiale del modello](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/) consultata il 2026-11-26: modello multilingua ottimizzato per dialogo e istruzioni, context window di **131.072 token**, function calling, reasoning, **Zero Data Retention** e streaming SSE tramite `AI.run(..., { stream: true })` con eventi `choices[0].delta.content` e chiusura `data: [DONE]`. Il prezzo indicato è **$0.0605/M token di input** e **$0.40/M token di output**; la [tabella pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) lo riporta come 5.500 Neurons/M di input e 36.400 Neurons/M di output. Non è nella lista dei modelli che richiedono obbligatoriamente un metodo di fatturazione a pagamento.

Il binding `AI` è sufficiente: **non inserire token o API key nel repository**. Workers AI usa le credenziali dell'account autenticato. Il frontend non riceve credenziali: chiama solo `/api/chat`.

In `wrangler.toml` il binding resta **commentato di default** e non viene attivato automaticamente:

```toml
# [ai]
# binding = "AI"

# [vars]
# Modello predefinito: @cf/zai-org/glm-4.7-flash (functions/lib/model.js).
# AI_MODEL = "@cf/zai-org/glm-4.7-flash"
```

`AI_MODEL` è un override server-side facoltativo: se non è impostato, handler e `/api/status` usano il modello predefinito. Per usare un modello diverso, verificare che sia disponibile nel proprio account prima di impostare `AI_MODEL`. Con Wrangler 4 è possibile usare un file `.dev.vars` per variabili locali; è già escluso da Git tramite `.gitignore`.

### Stato del binding verificato in questa attività

- `wrangler.toml` contiene `[ai]` e `binding = "AI"` **commentati**.
- `GET /api/status` in locale ha restituito `mode: "demo"`, `model: null` e `streaming: false`.
- Non esiste accesso alla dashboard Cloudflare in questa sessione: il binding **non è stato attivato** e non è stato eseguito alcun deploy.
- Non è quindi stato possibile verificare il modello reale, lo streaming remoto o la quota effettiva dell'account: la verifica locale usa mock SSE con lo stesso formato documentato da Cloudflare.

### Passaggi esatti in Dashboard (non eseguiti in questa attività)

Secondo la [documentazione Pages per i binding](https://developers.cloudflare.com/pages/functions/bindings/#workers-ai):

1. Aprire **Cloudflare Dashboard → Workers & Pages**.
2. Selezionare il progetto **Pages** di OliDuck.
3. Aprire **Settings**.
4. Selezionare l'ambiente Pages desiderato (**Production** oppure **Preview**) e andare in **Bindings → Add → Workers AI**.
5. In **Variable name** inserire esattamente `AI`.
6. Salvare e **ri-distribuire il progetto** affinché il binding diventi effettivo.

Non incollare token o API key: non servono. `AI_MODEL` va impostato solo in **Settings → Variables and Secrets** se si vuole sovrascrivere il modello; non è richiesto per il default. Il deploy non è stato eseguito e va fatto solo su autorizzazione esplicita.

Per il solo sviluppo locale è possibile esporre il binding con `npm run dev -- --port 8788 --ai=AI` oppure decommentando `[ai]` in `wrangler.toml`. La documentazione Cloudflare segnala che **l'uso di Workers AI in locale consuma comunque quota e può generare costi**: non è stato fatto in questa attività.

## 3. Deploy

### Opzione A — Wrangler CLI

```bash
npx wrangler login
npm run deploy
```

### Opzione B — Dashboard Cloudflare

1. Crea un progetto **Pages** e collega il repository GitHub.
2. Build command: **vuoto** (non c'è una build).
3. Build output directory: `public`.
4. In **Settings → (ambiente Production o Preview) → Bindings → Add → Workers AI**, aggiungi un binding con nome variabile `AI`.
5. In **Settings → Variables & Secrets**, imposta `AI_MODEL` solo se vuoi cambiare modello.
6. Salva e ridistribuisci.

La cartella `functions/` viene compilata automaticamente da Pages: non va inclusa nella build output directory.

### Compatibilità Wrangler

Le build Git-integrate di Pages compilano le Functions con una versione Wrangler gestita da Cloudflare (nel build fallito: `3.114.17`), indipendente dalla versione installata in locale o dichiarata in `package.json`. Il pinning di Wrangler 4 come `devDependency` non cambia quindi la compilazione eseguita da Pages.

Per questo i ponti CJS per i dati (`functions/lib/catalog-data.cjs`, `functions/data/teaching-kb-data.cjs` e il legacy `functions/data/rag-data.cjs`) usano `require` statico invece di import attributes ESM (`with { type: 'json' }`), non supportati da Wrangler 3. Il JSON viene risolto in fase di bundle sia da Wrangler 3 sia da Wrangler 4, ed è supportato anche da Node nei test. La sorgente del catalogo è `public/data/olicyber-challenges.json` (il vecchio `public/data/challenges.json` resta solo per test e fallback); non serve `nodejs_compat` e non vengono aggiunti dati o dipendenze.

## 4. Verifica

```bash
curl -s http://localhost:8788/api/status
```

Senza binding, lo stato include `mode: "demo"`, `model: null`, `streaming: false` e una nota che segnala la modalità DEMO. Con il binding e dopo la ri-distribuzione, lo stato segnala `mode: "ai"`, `model: "@cf/zai-org/glm-4.7-flash"` (salvo override) e `streaming: true`.

Test chat contestuale:

```bash
curl -s -X POST http://localhost:8788/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"challengeIds":["olicyber-1"],"message":"Come inizio?","history":[]}'
```

Test chat generale:

```bash
curl -s -X POST http://localhost:8788/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"challengeIds":[],"message":"Spiegami il boxing","history":[]}'
```

Con il binding attivo la risposta AI è `text/event-stream`; per leggerla:

```bash
curl -N -X POST http://localhost:8788/api/chat \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"challengeIds":["olicyber-1"],"message":"Spiegami una funzione hash","history":[]}'
```

Ogni evento contiene `reply` cumulativo; l'ultimo evento include anche `mode`, `model`, `challengeIds`, `challengeId` e `sources`. In caso di rifiuto l'ultimo evento ha `blocked: true`, in caso di errore `error` e `status`.

Il client invia solo `challengeIds` (massimo 6) e non il contenuto delle challenge: il server ricostruisce il contesto autorevole dal catalogo e usa solo la KB didattica. Il campo `challenge`, se inviato, non è accettato come fonte e viene ignorato. Le richieste di flag, soluzioni, writeup o payload vengono rifiutate deterministicamente prima della chiamata al modello. Per la procedura completa di verifica nel browser vedere [`AI-ARCHITECTURE.md`](AI-ARCHITECTURE.md#6-verifica-manuale-in-browser).

## 5. Anti-abuso, limiti e produzione

Il tutor applica limiti su messaggio (4.000 caratteri), cronologia (12 messaggi / 8.000 caratteri), body (16.000 byte), numero di challenge (massimo 6) e `max_completion_tokens` (700), con timeout assoluto di 20 secondi sull'intera generazione. Durante lo streaming gli ultimi 64 caratteri restano in buffer e il testo accumulato viene rivalutato prima di ogni invio: la redaction e il rilevamento di flag/procedure sono best-effort e non garantiscono matematicamente l'assenza di soluzioni nelle risposte. Il campo `reply` cumulativo permette al client di sostituire il testo parziale con un rifiuto se l'output diventa unsafe.

Il rate limiter in memoria è **per isolato** e risponde `429` con `Retry-After` quando il limite è superato: non è una garanzia globale distribuita. Per un servizio pubblico aggiungere:

- Cloudflare **WAF / Rate Limiting Rules** sul path `/api/chat`;
- **Bot Fight Mode** o Turnstile se si osserva abuso automatizzato;
- monitoraggio con **Workers Logs / Logpush** (gli errori del modello sono loggati lato server senza dati sensibili).

La quota giornaliera di Workers AI dipende dall'account: la [documentazione pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) consultata il 2026-11-26 indica **10.000 Neurons/giorno di allocazione gratuita**, **$0.011 per 1.000 Neurons** oltre la soglia sui piani Paid e azzeramento **alle 00:00 UTC**. L'uso effettivo si monitora nella dashboard **Workers AI**. Quando la quota esaurita viene rilevata, l'API risponde `503` con `Retry-After: 60` prima dell'inizio dello streaming, oppure emette un evento SSE con `status: 503` e `retryAfter: 60` se l'errore arriva durante la generazione. Il testo esposto al client non include dettagli interni del provider.

Il frontend non salva conversazioni sul server: non servono binding KV, D1, R2 o Vectorize per il funzionamento di base.

## 6. Catalogo e knowledge base

Vedi [`CATALOG-IMPORT.md`](CATALOG-IMPORT.md), [`DATASET.md`](DATASET.md) e [`PUBLIC-SOURCES-RESEARCH.md`](PUBLIC-SOURCES-RESEARCH.md). L'UI usa il catalogo reale `public/data/olicyber-challenges.json` (`imported-partial`, `verified: false`), generato dagli export browser; `public/data/challenges.json` resta il catalogo DEMO storico per test e fallback. Nessuno dei due contiene flag o soluzioni.

Il tutor usa solo `functions/data/teaching-kb.json` (ponte `teaching-kb-data.cjs`), con definizioni generali scritte per il progetto. L'indice `functions/data/rag-index.json` generato da `npm run dataset:browser-import` è legacy e non è più usato a runtime; la KB autorizzata del dataset pubblico resta vuota (0 documenti). Non eseguire deploy in produzione senza autorizzazione esplicita.

## 7. Troubleshooting

| Sintomo | Causa probabile | Soluzione |
| --- | --- | --- |
| Badge "modalità DEMO" | Binding `AI` assente | Aggiungere il binding da Dashboard e ridistribuire |
| `502` con binding AI | Modello non disponibile o errore provider | Verificare `AI_MODEL` nel catalogo dell'account; i dettagli interni non sono esposti al client |
| `503` nella chat | Quota AI giornaliera esaurita | Controllare i Neurons nella dashboard Workers AI; il client riceve `Retry-After` oppure un evento SSE con `retryAfter` |
| `504` nella chat | Timeout della generazione (20 s) | Riprovare con una domanda più breve |
| SSE con `blocked: true` | L'output ha superato i controlli | Il client mostra il rifiuto al posto del testo parziale; non è una garanzia assoluta |
| Badge "non raggiungibile" | Function non presente o fetch fallita | Verificare `functions/api/status.js` e il deploy di `functions/` |
| `429` nella chat | Limite richieste superato | Attendere il tempo indicato da `Retry-After`; valutare Rate Limiting Rules lato Cloudflare |
| `400` nella chat | Campi mancanti, troppo lunghi, troppe challenge o challenge sconosciuta | Controllare payload e limiti nel README |
| `413` / `415` | Body oltre 16.000 byte o Content-Type non JSON | Correggere la richiesta |
| Catalogo non disponibile | `public/data/olicyber-challenges.json` non pubblicato | Verificare output directory `public` e l'import browser |
| KB didattica non caricata | `functions/data/teaching-kb.json` o `teaching-kb-data.cjs` assenti | Verificare i file lato server; l'indice RAG dell'export browser non è un sostituto |
| Tema, larghezza o chat non persistenti | `localStorage` disabilitato | Controllare impostazioni browser/privacy |

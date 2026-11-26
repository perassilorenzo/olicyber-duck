# Guida alla configurazione Cloudflare

OliDuck usa **Cloudflare Pages**: file statici in `public/`, backend in `functions/`, modello tramite Workers AI.

## 1. Sviluppo locale

```bash
npm install
npm test
npm run dev -- --port 8788
```

Apri `http://localhost:8788`. Senza binding AI, `GET /api/status` restituisce `mode: "demo"` e `POST /api/chat` restituisce una risposta simulata **etichettata come DEMO**, con eventuale contesto RAG locale nei metadati delle fonti. Non serve alcuna API key per questa modalità.

## 2. Abilitare Workers AI

In `wrangler.toml` decommentare:

```toml
[ai]
binding = "AI"

[vars]
AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
```

Il binding `AI` è sufficiente: **non inserire token o API key nel repository**. Workers AI usa le credenziali dell'account autenticato da Wrangler.

Il modello predefinito è definito una sola volta in `functions/lib/model.js`:

```
@cf/meta/llama-3.3-70b-instruct-fp8-fast
```

Il vecchio identificativo `@cf/meta/llama-3.3-70b-instruct-fp8` non è più disponibile (404 nel catalogo modelli). Se `AI_MODEL` non è impostato, handler e `/api/status` usano comunque il modello corretto. Per usare un modello diverso, verificare che sia disponibile nel proprio account prima di impostare `AI_MODEL`.

Con Wrangler 4 è possibile usare un file `.dev.vars` per variabili locali; è già escluso da Git tramite `.gitignore`.

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
4. In **Settings → Functions → Bindings**, aggiungi un binding **Workers AI** con nome variabile `AI`.
5. In **Settings → Environment variables**, imposta `AI_MODEL` solo se vuoi cambiare modello.
6. Salva e ridistribuisci.

La cartella `functions/` viene compilata automaticamente da Pages: non va inclusa nella build output directory.

### Compatibilità Wrangler

Le build Git-integrate di Pages compilano le Functions con una versione Wrangler gestita da Cloudflare (nel build fallito: `3.114.17`), indipendente dalla versione installata in locale o dichiarata in `package.json`. Il pinning di Wrangler 4 come `devDependency` non cambia quindi la compilazione eseguita da Pages.

Per questo `functions/lib/catalog.js` e `functions/data/rag-data.cjs` non usano import attributes ESM (`with { type: 'json' }`), non supportati da Wrangler 3, ma importano file `.cjs` con `require` statico: il JSON viene risolto in fase di bundle sia da Wrangler 3 sia da Wrangler 4, ed è supportato anche da Node nei test. La sorgente del catalogo è `public/data/olicyber-challenges.json` (il vecchio `public/data/challenges.json` resta solo per test e fallback); l'indice RAG sta in `functions/data/rag-index.json` e non viene pubblicato. Non serve `nodejs_compat` e non vengono aggiunti dati o dipendenze.

## 4. Verifica

```bash
curl -s http://localhost:8788/api/status
```

Atteso senza binding:

```json
{
  "mode": "demo",
  "model": null,
  "note": "Binding AI non configurato: il backend risponde in modalità DEMO.",
  "catalog": {
    "schemaVersion": 2,
    "status": "imported-partial",
    "verified": false,
    "imported": 735,
    "source": "OliCyber Training",
    "lastSync": "2026-11-26T09:35:38.941Z"
  },
  "rag": {
    "connected": true,
    "documents": 736,
    "chunks": 1189,
    "generatedAt": "2026-11-26T09:35:38.941Z",
    "source": "OliCyber Training (export browser autorizzato)",
    "settings": { "chunkSize": 600, "overlap": 80, "maxCharsPerDoc": 5000, "maxChunksPerDoc": 14 }
  }
}
```

Test chat contestuale:

```bash
curl -s -X POST http://localhost:8788/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"challengeId":"olicyber-1","message":"Come inizio?","history":[]}'
```

Test chat generale:

```bash
curl -s -X POST http://localhost:8788/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"challengeId":"general","message":"Spiegami il boxing","history":[]}'
```

Il contesto della challenge **non va mai inviato dal client**: il server lo ricostruisce da `challengeId` e recupera eventuali chunk RAG locali pertinenti. Un payload con un campo `challenge` viene accettato ma ignorato. La risposta include `sources` con soli metadati (titolo, ID, indice, punteggio): gli snippet del RAG non vengono restituiti.

## 5. Anti-abuso e produzione

Il rate limiter di `functions/lib/rate-limit.js` consente 12 richieste/minuto per IP, calcolato **per isolato Workers**: non è una garanzia globale distribuita. Per un servizio pubblico aggiungere:

- Cloudflare **WAF / Rate Limiting Rules** sul path `/api/chat`;
- **Bot Fight Mode** o Turnstile se si osserva abuso automatizzato;
- monitoraggio con **Workers Logs / Logpush** (gli errori del modello sono loggati lato server senza dati sensibili).

Il frontend non salva conversazioni sul server: non servono binding KV, D1, R2 o Vectorize per il funzionamento di base. Il RAG è un indice JSON locale lato server, non un servizio esterno.

## 6. Aggiornare il catalogo

Vedi [`CATALOG-IMPORT.md`](CATALOG-IMPORT.md) e [`PUBLIC-SOURCES-RESEARCH.md`](PUBLIC-SOURCES-RESEARCH.md). L'UI usa il catalogo reale `public/data/olicyber-challenges.json` (`imported-partial`, `verified: false`), generato dagli export browser; `public/data/challenges.json` resta il catalogo DEMO storico per test e fallback. Nessuno dei due contiene flag o soluzioni. Per rigenerare catalogo e indice RAG: `npm run dataset:browser-import`. Non eseguire deploy in produzione senza autorizzazione esplicita.

## 7. Troubleshooting

| Sintomo | Causa probabile | Soluzione |
| --- | --- | --- |
| Badge "modalità DEMO" | Binding `AI` assente | Aggiungere binding e ridistribuire |
| `502` con binding AI | Modello non disponibile o errore provider | Verificare `AI_MODEL` nel catalogo dell'account; i dettagli interni non sono esposti al client |
| Badge "non raggiungibile" | Function non presente o fetch fallita | Verificare `functions/api/status.js` e il deploy di `functions/` |
| `429` nella chat | Limite richieste superato | Attendere il tempo indicato da `Retry-After` |
| `400` nella chat | Campi mancanti, troppo lunghi o challenge sconosciuta | Controllare payload e limiti nel README |
| `413` / `415` | Body oltre 16 KB o Content-Type non JSON | Correggere la richiesta |
| Catalogo non disponibile | `public/data/olicyber-challenges.json` non pubblicato | Verificare output directory `public` e l'import browser |
| Indice RAG vuoto | `functions/data/rag-index.json` assente o non bundle | Verificare `npm run dataset:browser-import` e il ponte `rag-data.cjs` |
| Tema, larghezza o chat non persistenti | `localStorage` disabilitato | Controllare impostazioni browser/privacy |

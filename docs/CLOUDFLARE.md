# Guida alla configurazione Cloudflare

OliDuck usa **Cloudflare Pages**: file statici in `public/`, backend in `functions/`, modello tramite Workers AI.

## 1. Sviluppo locale

```bash
npm install
npm test
npm run dev -- --port 8788
```

Apri `http://localhost:8788`. Senza binding AI, `GET /api/status` restituisce `mode: "demo"` e `POST /api/chat` restituisce una risposta simulata **etichettata come DEMO**. Non serve alcuna API key per questa modalità.

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
    "status": "unverified-demo",
    "verified": false,
    "imported": 7,
    "source": "OliDuck DEMO (non ufficiale)",
    "lastSync": null
  }
}
```

Test chat contestuale:

```bash
curl -s -X POST http://localhost:8788/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"challengeId":"demo-web-01","message":"Come inizio?","history":[]}'
```

Test chat generale:

```bash
curl -s -X POST http://localhost:8788/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"challengeId":"general","message":"Spiegami il boxing","history":[]}'
```

Il contesto della challenge **non va mai inviato dal client**: il server lo ricostruisce da `challengeId`. Un payload con un campo `challenge` viene accettato ma ignorato.

## 5. Anti-abuso e produzione

Il rate limiter di `functions/lib/rate-limit.js` consente 12 richieste/minuto per IP, calcolato **per isolato Workers**: non è una garanzia globale distribuita. Per un servizio pubblico aggiungere:

- Cloudflare **WAF / Rate Limiting Rules** sul path `/api/chat`;
- **Bot Fight Mode** o Turnstile se si osserva abuso automatizzato;
- monitoraggio con **Workers Logs / Logpush** (gli errori del modello sono loggati lato server senza dati sensibili).

Il frontend non salva conversazioni sul server: non servono binding KV, D1 o R2 per il funzionamento di base.

## 6. Aggiornare il catalogo

Vedi [`CATALOG-IMPORT.md`](CATALOG-IMPORT.md) e [`PUBLIC-SOURCES-RESEARCH.md`](PUBLIC-SOURCES-RESEARCH.md). Il catalogo attuale resta `unverified-demo`: non è il catalogo ufficiale OliCyber Training e non contiene flag o soluzioni.

## 7. Troubleshooting

| Sintomo | Causa probabile | Soluzione |
| --- | --- | --- |
| Badge "modalità DEMO" | Binding `AI` assente | Aggiungere binding e ridistribuire |
| `502` con binding AI | Modello non disponibile o errore provider | Verificare `AI_MODEL` nel catalogo dell'account; i dettagli interni non sono esposti al client |
| Badge "non raggiungibile" | Function non presente o fetch fallita | Verificare `functions/api/status.js` e il deploy di `functions/` |
| `429` nella chat | Limite richieste superato | Attendere il tempo indicato da `Retry-After` |
| `400` nella chat | Campi mancanti, troppo lunghi o challenge sconosciuta | Controllare payload e limiti nel README |
| `413` / `415` | Body oltre 16 KB o Content-Type non JSON | Correggere la richiesta |
| Catalogo non disponibile | `public/data/challenges.json` non pubblicato | Verificare output directory `public` |
| Tema, larghezza o chat non persistenti | `localStorage` disabilitato | Controllare impostazioni browser/privacy |

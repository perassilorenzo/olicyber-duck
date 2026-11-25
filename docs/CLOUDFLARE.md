# Guida alla configurazione Cloudflare

OliDuck è pensato per Cloudflare Pages: file statici in `public/`, backend in `functions/`, modello tramite Workers AI.

## 1. Sviluppo locale

```bash
npm install
npm run dev        # wrangler pages dev public
npm test
```

Senza binding AI, `GET /api/status` restituisce `mode: "demo"` e `POST /api/chat` restituisce una risposta simulata **etichettata come DEMO**. Non è necessaria alcuna API key per questa modalità.

## 2. Abilitare Workers AI

Nel file `wrangler.toml` decommentare:

```toml
[ai]
binding = "AI"

[vars]
AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8"
```

Il binding `AI` è sufficiente: **non inserire token o API key nel repository**. Workers AI usa le credenziali dell'account autenticato da Wrangler.

Modelli alternativi supportati dal proprio account, ad esempio:

```toml
[vars]
AI_MODEL = "@cf/meta/llama-3.1-8b-instruct"
```

Se `AI_MODEL` non è impostato, il backend usa `@cf/meta/llama-3.3-70b-instruct-fp8`.

Con Wrangler 4 è anche possibile usare un file `.dev.vars` per variabili locali; è già escluso da Git tramite `.gitignore`. Non metterci segreti che non siano necessari al frontend: il frontend non ne riceve alcuno.

## 3. Deploy

### Opzione A — Wrangler CLI

```bash
npx wrangler login
npm run deploy
```

### Opzione B — Dashboard Cloudflare

1. Crea un nuovo progetto **Pages**.
2. Collega il repository GitHub `perassilorenzo/olicyber-duck`.
3. Build command: **vuoto** (non c'è una build).
4. Build output directory: `public`.
5. In **Settings → Functions → Bindings**, aggiungi un binding di tipo **Workers AI** con nome variabile `AI`.
6. In **Settings → Environment variables**, imposta `AI_MODEL` se vuoi cambiare modello.
7. Salva e ridistribuisci.

La cartella `functions/` viene compilata automaticamente da Pages: non va inclusa nella build output directory.

## 4. Verifica

```bash
curl https://<tuo-progetto>.pages.dev/api/status
```

Atteso con AI configurata:

```json
{ "mode": "ai", "model": "@cf/meta/llama-3.3-70b-instruct-fp8", "note": "Assistente AI configurato." }
```

Test chat:

```bash
curl -X POST https://<tuo-progetto>.pages.dev/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"challengeId":"demo-web-01","challenge":{"id":"demo-web-01","title":"Il parametro dimenticato","category":"Web","difficulty":"Facile","description":"Demo","statement":"Demo","tags":[],"learningGoals":[],"hintTopics":["query string"],"demo":true},"message":"Come inizio?","history":[]}'
```

## 5. Anti-abuso e produzione

Il rate limiter di `functions/lib/rate-limit.js` consente 12 richieste/minuto per IP, calcolato **per isolato Workers**: non è una garanzia globale distribuita. Per un servizio pubblico aggiungere:

- Cloudflare **WAF / Rate Limiting Rules** sul path `/api/chat`;
- **Bot Fight Mode** o Turnstile se si osserva abuso automated;
- monitoraggio con **Workers Logs / Logpush** (gli errori del modello sono già loggati lato server senza dati sensibili).

Il frontend non salva conversazioni sul server: non sono necessarie binding KV, D1 o R2 per il funzionamento di base.

## 6. Aggiornare il catalogo

Modificare `public/data/challenges.json` e ridistribuire. Per importare challenge delle edizioni precedenti verificare fonte e URL, impostare `demo: false` e mantieni `externalUrl: null` quando non esiste un link ufficiale verificato. Non inserire flag nel catalogo dimostrativo.

## 7. Troubleshooting

| Sintomo | Causa probabile | Soluzione |
| --- | --- | --- |
| Badge "modalità DEMO" | Binding `AI` assente | Aggiungere binding e ridistribuire |
| Badge "non raggiungibile" | Function non presente o fetch fallita | Verificare `functions/api/status.js` e il deploy di `functions/` |
| `429` nella chat | Limite richieste superato | Attendere il tempo indicato da `Retry-After` |
| `400` nella chat | Campi mancanti o troppo lunghi | Controllare payload e limiti nel README |
| Catalogo non disponibile | `public/data/challenges.json` non pubblicato | Verificare output directory `public` |
| Tema o chat non persistono | `localStorage` disabilitato | Controllare impostazioni browser/privacy |

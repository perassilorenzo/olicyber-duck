# Architettura AI sicura del tutor OliDuck

Questo documento descrive l'architettura del tutor AI sul ramo `feature/oliduck-app`. Il tutor gira interamente lato server tramite il binding `AI` di **Cloudflare Workers AI**: non esistono API key nel repository né nel frontend.

Senza binding il backend resta in modalità **DEMO**: `GET /api/status` restituisce `mode: "demo"`.

## 1. Flusso dei dati

```text
Frontend → POST /api/chat → validazione e contesto autorevole (lato server)
         → KB didattica autorizzata → Workers AI (stream: true)
         → SSE del provider → buffer di sicurezza + redaction → SSE del tutor → frontend
```

1. **Frontend**: l'utente seleziona al massimo 6 challenge con il pulsante **Chat**; il click su una card apre solo il drawer dei dettagli. Il client invia `challengeIds`, `message` e `history`, senza inviare testo delle challenge.
2. **Validazione e contesto autorevole**: `/api/chat` applica i limiti e il rifiuto deterministico delle richieste di flag/soluzioni, poi ricostruisce il contesto delle challenge dal catalogo lato server. Il campo `challenge` non è accettato come fonte autorevole: eventuali dati inviati dal client vengono ignorati.
3. **KB didattica**: il retrieval usa solo `functions/data/teaching-kb.json` (con ponte CJS `teaching-kb-data.cjs`). Contiene esclusivamente definizioni generali di concetti di informatica e cybersecurity scritte appositamente per il progetto: nessuna descrizione di challenge, statement, hint, flag, soluzione, writeup, payload o allegato.
4. **Workers AI**: con il binding `AI` presente, l'handler chiama `AI.run(model, { messages, stream: true, max_completion_tokens: 700, temperature: 0.35, chat_template_kwargs: { enable_thinking: false } })`. La documentazione Cloudflare conferma che lo stream è SSE con `choices[0].delta.content` e terminatore `data: [DONE]`. Senza binding restituisce una risposta simulata ed etichettata come DEMO in JSON.
5. **Output**: il backend converte gli SSE del provider in eventi del tutor con campo `reply` cumulativo e autorevole. Ogni blocco viene rivalutato con `outputLooksUnsafe` prima della redaction; gli ultimi 64 caratteri restano in buffer fino alla fine per non trasmettere flag divisi tra chunk. L'ultimo evento include `mode` (`demo` o `ai`), `model`, `challengeIds`, `challengeId` (o `general`) e `sources` con soli metadati della KB. Le richieste bloccate riportano `blocked: true`; il client sostituisce il testo parziale con il rifiuto. Il testo della KB, gli hint, il ragionamento interno e i flag non vengono esposti.

### Separazione delle knowledge base

| Origine | Stato | Uso da parte del tutor |
| --- | --- | --- |
| `functions/data/teaching-kb.json` (`teaching-kb-data.cjs`) | KB didattica originale del progetto, definizioni generali | **Usata a runtime** |
| `functions/data/rag-index.json`, generato da `scripts/import-browser-export.mjs` | Indice derivato dalle challenge dell'export browser | **Legacy, non più usata a runtime** |
| `dataset-input/rag-index.json`, generato da `npm run dataset:build` | KB autorizzata del dataset di fonti pubbliche, oggi vuota (0 documenti) | Non usata: non contiene documenti |

Vedi [`DATASET.md`](DATASET.md) per la provenienza del dataset e [`CLOUDFLARE.md`](CLOUDFLARE.md) per la configurazione del binding.

## 2. Dati del contesto challenge

Il server invia al modello solo i metadati pubblici affidabili della challenge:

| Inclusi nel contesto | Esclusi sempre |
| --- | --- |
| ID (`id`) | descrizione |
| ID originale (`originalId`) | statement |
| titolo (`title`) | hint |
| categoria (`category`) | `learningGoals` |
| tag (`tags`) | allegati e relativo testo |
| difficulty, solo quando affidabile | URL |
| punteggio (`score`) | stato della challenge |
| — | metadata sensibili (flag, soluzioni, writeup, payload) |

Il client invia solo `challengeIds` (massimo 6); ogni altro dato viene ricostruito dal server dal catalogo. La chat generale non ha contesto challenge.

## 3. Modello e motivazione

**Modello predefinito**: `@cf/zai-org/glm-4.7-flash` (GLM-4.7-Flash di Zhipu AI, ospitato da Cloudflare). La scelta è provvisoria e segue l'indicazione dell'utente; la [pagina ufficiale del modello](https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/) è stata consultata il **2026-11-26**.

Caratteristiche rilevanti:

- modello multilingua veloce, ottimizzato per dialogo e instruction following;
- context window di **131.072 token**;
- function calling e reasoning;
- **Zero Data Retention (ZDR)**;
- **streaming SSE** con `stream: true`, eventi `choices[0].delta.content` e chiusura `data: [DONE]`;
- prezzo **$0.0605/M token di input** e **$0.40/M token di output** secondo la pagina del modello; la tabella pricing riporta **5.500 Neurons/M** di input e **36.400 Neurons/M** di output.

Il modello è centralizzato in `functions/lib/model.js`; `AI_MODEL` è un override server-side facoltativo, non una configurazione richiesta. Nel payload vengono usati `max_completion_tokens` (il parametro `max_tokens` è deprecato per questo modello) e `chat_template_kwargs.enable_thinking: false`: il tutor non deve consumare token di ragionamento né mostrare il pensiero interno allo studente.

### Quota e costi

La quota giornaliera dipende dall'account: la [documentazione pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) consultata il 2026-11-26 indica **10.000 Neurons/giorno di allocazione gratuita**, **$0.011 per 1.000 Neurons** oltre la soglia sui piani Paid e azzeramento alle **00:00 UTC**. L'utilizzo reale va controllato nella dashboard **Workers AI**. Non promettere utilizzo illimitato: quota e costi dipendono dall'account e dal modello.

La gestione errori distingue:

- `429` del provider o pattern di quota/rate limit → risposta `503` con `Retry-After: 60`, oppure evento SSE con `status: 503` e `retryAfter: 60` se l'errore sopraggiunge durante lo streaming;
- timeout assoluto di 20 secondi → `504` oppure evento SSE con `status: 504`;
- altri errori → `502` oppure evento SSE con `status: 502`, senza dettagli interni;
- risposta vuota o non utilizzabile → `502`.

## 4. Controlli input/output e loro limiti

| Controllo | Effetto | Limite da dichiarare |
| --- | --- | --- |
| Filtro deterministico lato server prima della chiamata al modello | Rifiuta richieste che chiedono flag, soluzioni, writeup o payload | Non garantisce matematicamente l'assenza di soluzioni nelle risposte |
| System prompt con confine casuale per richiesta | Dati non attendibili separati dalle istruzioni di sistema | Non elimina ogni possibile prompt injection |
| Redaction best-effort dell'output | Rimuove pattern sensibili dalla risposta | Best-effort: non esaustiva |
| Limiti di richiesta | messaggio 4.000 caratteri; cronologia 12 messaggi / 8.000 caratteri; body 16.000 byte; massimo 6 challenge; `max_completion_tokens: 700`; timeout 20 s | I limiti sono validati lato server, non solo nell'UI |
| Controllo incrementale durante lo streaming | Il testo accumulato viene rivalutato a ogni chunk; ultimi 64 caratteri in buffer; `reply` cumulativo sostituibile con il rifiuto | Best-effort: non garantisce matematicamente l'assenza di soluzioni |
| Rate limiter in memoria per isolato | Risponde `429` con `Retry-After` quando il limite è superato | Non è distribuito: non vale come limite globale tra isolati |
| Binding `AI` lato server | Nessuna API key nel repository o nel frontend | Il binding non viene attivato automaticamente: serve dashboard/account |
| Raccomandazione di produzione | Affiancare Cloudflare **Rate Limiting Rules / WAF** sul path `/api/chat` | Configurazione lato account, non presente nel repository |

## 5. Configurazioni Cloudflare mancanti

Al momento `wrangler.toml` mantiene il binding **commentato**: questa è la configurazione attesa per la modalità DEMO. Non è stato attivato alcun binding e non è stato eseguito alcun deploy.

Per abilitare il tutor in un account Cloudflare:

1. In **Cloudflare Dashboard → Workers & Pages → progetto Pages → Settings → (ambiente Production o Preview) → Bindings → Add → Workers AI**, aggiungere un binding con nome variabile `AI`.
2. In **Settings → Variables & Secrets** si può impostare, solo se necessario, `AI_MODEL` per l'override server-side del modello. Non incollare token o API key.
3. Dopo aver aggiunto il binding, **ri-distribuire il progetto** affinché la configurazione diventi effettiva. Questo passaggio è documentato ma non eseguito in questa attività.

In alternativa, chi gestisce il repository può decommentare in `wrangler.toml` il blocco `[ai] binding = "AI"`. Anche in quel caso la variabile resta facoltativa e non vanno mai inserite credenziali nel file.

## 6. Verifica manuale in browser

1. Avviare l'ambiente locale con `npm run dev -- --port 8788` e aprire `http://localhost:8788`.
2. Visitare `http://localhost:8788/api/status`: senza binding devono comparire `mode: "demo"`, `model: null` e `streaming: false`. Sono presenti i metadati `catalog` e `knowledge` (KB didattica); la chiave storica `rag` descrive anch'essa la KB didattica, non le challenge.
3. Nell'app, verificare che il badge indichi la modalità DEMO.
4. Cliccare una card: deve aprirsi solo il drawer dei dettagli, senza aggiungere la challenge al contesto della chat.
5. Usare il pulsante **Chat** su più card: la selezione deve fermarsi a 6 challenge.
6. Inviare una domanda generale (per esempio "Spiegami il boxing") e una contestuale (per esempio "Come posso iniziare?"): la risposta DEMO deve essere etichettata come tale e non deve contenere hint, flag o soluzioni.
7. Provare richieste esplicite di flag, soluzioni, writeup o payload: devono essere rifiutate in modo deterministico lato server, prima della chiamata al modello, con risposta `blocked: true`.
8. Dopo l'aggiunta del binding `AI` e la ri-distribuzione, ripetere la verifica di `/api/status`: devono comparire `mode: "ai"`, `streaming: true` e il modello `@cf/zai-org/glm-4.7-flash`, salvo override via `AI_MODEL`.
9. Inviare una domanda con `curl -N` (vedi `CLOUDFLARE.md`): la risposta deve essere `text/event-stream` con eventi `data:` muniti di `reply` cumulativo; l'ultimo evento deve contenere `mode`, `model` e `sources`. Non è stato possibile eseguire questo passaggio senza binding e senza accesso alla dashboard.

Per i dettagli dei limiti delle API e delle risposte di errore vedere [`README.md`](../README.md).

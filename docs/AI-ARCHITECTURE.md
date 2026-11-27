# Architettura AI sicura del tutor OliDuck

Questo documento descrive l'architettura del tutor AI sul ramo `feature/oliduck-app`. Il tutor gira interamente lato server tramite il binding `AI` di **Cloudflare Workers AI**: non esistono API key nel repository né nel frontend. Per il manuale operativo completo vedere [`OLIDUCK-HANDBOOK.md`](OLIDUCK-HANDBOOK.md).

Senza binding il backend resta in modalità **DEMO**: `GET /api/status` restituisce `mode: "demo"`.

## 1. Flusso dei dati

```text
Frontend → POST /api/chat → validazione e contesto autorevole (lato server)
         → KB didattica autorizzata → Workers AI (stream: true)
         → SSE del provider → buffer di sicurezza + redaction → SSE del tutor → frontend
```

1. **Frontend**: l'utente seleziona al massimo 6 challenge con il pulsante **Chat** o con **Chiedi a OliDuck** dal drawer; in entrambi i casi la challenge richiesta diventa il contesto primario. Il click su una card apre solo il drawer dei dettagli. Ogni chat conserva il proprio contesto: **Nuova chat** è sempre generale e non eredita le challenge selezionate; riaprire una chat dalla cronologia ripristina i suoi ID challenge. Il client invia `challengeIds`, `message` e `history` e, facoltativamente, un `statementExcerpt` incollato dallo studente; non invia il testo delle challenge. Nelle conversazioni lunghe invia le prime domande che stabiliscono l'argomento insieme agli scambi recenti.
2. **Validazione e contesto autorevole**: `/api/chat` applica i limiti, ripulisce l'estratto, classifica l'intenzione lato server (anche in senso contestuale) e ricostruisce il contesto delle challenge dal catalogo. Il campo `challenge` non è accettato come fonte autorevole: eventuali dati inviati dal client vengono ignorati.
3. **KB didattica**: il retrieval usa solo `functions/data/teaching-kb.json` (con ponte CJS `teaching-kb-data.cjs`). Contiene esclusivamente definizioni generali di concetti di informatica e cybersecurity scritte appositamente per il progetto: nessuna descrizione di challenge, statement, hint, flag, soluzione, writeup, payload o allegato. Le domande dello studente presenti nella cronologia contribuiscono al recupero, così un follow-up breve come «fammi un esempio» continua a trovare il documento del concetto già discusso.
4. **Workers AI**: con il binding `AI` presente, l'handler chiama `AI.run(model, { messages, stream: true, max_completion_tokens: 700, temperature: 0.35, chat_template_kwargs: { enable_thinking: false } })`. La documentazione Cloudflare conferma che lo stream è SSE con `choices[0].delta.content` e terminatore `data: [DONE]`. Senza binding restituisce una risposta simulata ed etichettata come DEMO in JSON.
5. **Output**: il backend converte gli SSE del provider in eventi del tutor con campo `reply` cumulativo e autorevole. Ogni blocco viene rivalutato con `outputLooksUnsafe` prima della redaction; gli ultimi 64 caratteri restano in buffer fino alla fine per non trasmettere flag divisi tra chunk. L'ultimo evento include `mode` (`demo` o `ai`), `model`, `challengeIds`, `challengeId` (o `general`), `intent`, `statementProvided`, `statementMissing`, `hintStage`, `personalContext`, `support` (quando pertinenti), `statementStatus`, `catalogVerified`, `contextMode`, `challengeCount`, `followUp`, `followUpKind`, `conversationTopic`, `technologies`, `previousIntent`, `challengeLinkRequested`, `regenerated`, `incomplete` e `sources` con soli metadati della KB. Le risposte palesemente incomplete vengono rigenerate una sola volta con un'istruzione aggiuntiva nel messaggio `system`; se il tentativo non riesce viene inviato un messaggio esplicito con `incomplete: true`, senza inventare contenuti. Le richieste bloccate riportano `blocked: true`; i chiarimenti riportano `needsClarification: true` senza bloccare; il client sostituisce il testo parziale con il rifiuto o con la rigenerazione. Il testo della KB, gli hint, il ragionamento interno e i flag non vengono esposti. Il frontend renderizza il Markdown con DOM API, senza `innerHTML`.

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

Il client invia solo `challengeIds` (massimo 6); ogni altro dato viene ricostruito dal server dal catalogo. La chat generale non ha contesto challenge. Il primo ID dell'array è il contesto primario: un cambio esplicito di challenge sposta quell'ID in testa, conservando la cronologia della conversazione. L'eventuale `statementExcerpt` è un testo incollato dallo studente: limitato a 2.000 caratteri, privato di flag evidenti e caratteri di controllo, delimitato come dato non attendibile in un messaggio `user` separato; non viene mai confrontato con il catalogo né salvato come fonte. Il frontend lo conserva nei metadati della chat, così i follow-up della stessa conversazione ricevono lo stesso estratto; il campo visibile viene svuotato dopo l'invio. `buildDeliveryStatus` produce uno stato strutturato (`unavailable`, `partial`, `user-provided`, `verified`) che viene inviato al modello come blocco separato dal testo e restituito al client come `statementStatus` insieme a `catalogVerified`. Il catalogo reale ha `catalogVerified: false`: uno stato `verified` non può essere generato dall'estratto dell'utente.

### Workspace e contesto persistente

La shell ha tre aree: cronologia/navigazione a sinistra, Training e libreria al centro, tutor a destra. `public/src/store.js` mantiene `conversationMeta` (titolo, `kind`, `challengeIds`, `statementExcerpt`, `createdAt`, `updatedAt`), `activeConversation` e la preferenza `assistantCollapsed` senza cambiare `SCHEMA_VERSION = 2`. `public/src/assistant.js` gestisce chiavi storiche (`general`, `ctx:<ids>`) e nuove chat esplicite (`chat:<timestamp>-<random>`); `public/src/history.js` le elenca, apre, rinomina ed elimina con conferma; `public/src/training.js` mostra statistiche reali e azioni rapide. Il tutor è comprimibile e ripristinabile senza perdere la chat corrente. Questi flussi sono coperti da `tests/workspace-history.test.mjs` e `tests/ui.test.mjs`.

## 3. Intenzioni didattiche

`functions/lib/intent.js` classifica il messaggio corrente lato server; `functions/lib/conversation.js` può reinterpretare i riferimenti brevissimi in base alla cronologia. Gli intent possibili sono:

| Intento | Effetto |
| --- | --- |
| `explain_statement` | Con estratto: spiegazione del testo incollato. Senza estratto: risposta deterministica con `statementMissing: true` e `needsClarification: true`, nessuna chiamata al modello. |
| `explain_concept` | Spiegazione teorica di un concetto, nessuna risoluzione. |
| `request_hint` | Hint progressivo in tre livelli calcolati dal server (`hintStage`): concetto, osservazione generale, domanda per un'ipotesi. |
| `review_reasoning` | Analisi letterale del ragionamento, anche ambiguo o solo operativo; domanda mirata senza verifica affrettata. |
| `request_solution` | Rifiuto deterministico prima della chiamata al modello, con formulazione variata ma prefisso stabile. |
| `clarify` | Risposta mirata di chiarimento, `needsClarification: true`, nessuna chiamata al modello e nessun `blocked: true`. Se il messaggio segnala difficoltà personale senza un intento didattico, la risposta è empatica e riporta `support: true`. |
| `follow_up` | Il messaggio riprende il dialogo precedente («intendo Python», «in Flask», «fammi un esempio», «non ho capito», «continua», «e nella challenge?»): il modello riceve concetto, tecnologie esplicitamente menzionate e intento precedente in un blocco delimitato. |

La classificazione contestuale non può aggirare la sicurezza: una richiesta esplicita di soluzione nel messaggio corrente viene sempre bloccata e un riferimento come «continua» dopo un rifiuto resta un `request_solution`. Le precisazioni tecniche non fanno inventare framework: il blocco inviato al modello contiene solo tecnologie menzionate esplicitamente e il prompt chiede di distinguere, per esempio, `requests.Session()`, `flask.session` e sessioni Django.

La presenza di termini come `challenge`, `HTTP`, `token`, `exploit`, `flag` o `risolvere` non blocca da sola: servono verbs/oggetti espliciti di produzione della soluzione. Le formulazioni teoriche (`che cos'è una flag?`, `come funziona un payload?`) restano domande didattiche. `detectSolutionRequest` è stato mantenuto come wrapper per compatibilità con i chiamanti storici. La difficoltà personale è un segnale separato (`personalContext`): non crea un nuovo intento e non allenta il rifiuto se è presente una richiesta esplicita di flag o soluzione.

L'istruzione di intento viene aggiunta solo al messaggio `system`, quindi in un canale attendibile generato dal server; il messaggio dello studente, la cronologia, i metadati della KB e l'estratto restano in messaggi `user` delimitati da un confine casuale per richiesta. Esempi operativi sono in [`docs/TUTOR-BEHAVIOR.md`](TUTOR-BEHAVIOR.md).

## 4. Modello e motivazione

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

## 5. Controlli input/output e loro limiti

| Controllo | Effetto | Limite da dichiarare |
| --- | --- | --- |
| Classificazione deterministica lato server prima della chiamata al modello | Rifiuta solo richieste esplicite di flag, soluzioni, writeup o payload; i casi ambigui chiedono chiarimenti | Non garantisce matematicamente l'assenza di soluzioni nelle risposte |
| System prompt con confine casuale per richiesta | Dati non attendibili separati dalle istruzioni di sistema; intento scritto solo nel messaggio `system` | Non elimina ogni possibile prompt injection |
| Redaction best-effort dell'output | Rimuove pattern sensibili dalla risposta | Best-effort: non esaustiva |
| Limiti di richiesta | messaggio 4.000 caratteri; cronologia 24 messaggi / 8.000 caratteri (con ancore e scambi recenti); body 16.000 byte; massimo 6 challenge; `max_completion_tokens: 700`; timeout 20 s | I limiti sono validati lato server, non solo nell'UI |
| Completezza dell'output | elenchi vuoti, titoli senza contenuto, troncamenti e chiarimenti ripetuti vengono rilevati; al massimo una rigenerazione | Best-effort: non verifica la correttezza tecnica e non riscrive il contenuto |
| Controllo incrementale durante lo streaming | Il testo accumulato viene rivalutato a ogni chunk; ultimi 64 caratteri in buffer; `reply` cumulativo sostituibile con il rifiuto | Best-effort: non garantisce matematicamente l'assenza di soluzioni |
| Rate limiter in memoria per isolato | Risponde `429` con `Retry-After` quando il limite è superato | Non è distribuito: non vale come limite globale tra isolati |
| Binding `AI` lato server | Nessuna API key nel repository o nel frontend | Il binding è dichiarato in `wrangler.toml`, ma va verificato nel progetto Pages remoto |
| Renderer Markdown lato client | Solo nodi DOM, nessun `innerHTML` per risposte del modello; link HTTPS | Sottoinsieme di Markdown, non un parser completo |
| Raccomandazione di produzione | Affiancare Cloudflare **Rate Limiting Rules / WAF** sul path `/api/chat` | Configurazione lato account, non presente nel repository |

## 6. Configurazioni Cloudflare da verificare

`wrangler.toml` contiene `[ai] binding = "AI"` **attivo** in `HEAD`. Non è stato eseguito alcun deploy e non esiste accesso alla dashboard in questa sessione: il binding del progetto Pages remoto resta da verificare. Senza `env.AI` effettivo l'handler risponde comunque in modalità DEMO.

Per abilitare il tutor in un account Cloudflare:

1. In **Cloudflare Dashboard → Workers & Pages → progetto Pages → Settings → (ambiente Production o Preview) → Bindings → Add → Workers AI**, aggiungere un binding con nome variabile `AI`.
2. In **Settings → Variables & Secrets** si può impostare, solo se necessario, `AI_MODEL` per l'override server-side del modello. Non incollare token o API key.
3. Dopo aver aggiunto il binding, **ri-distribuire il progetto** affinché la configurazione diventi effettiva. Questo passaggio è documentato ma non eseguito in questa attività.

Il blocco `[ai]` è già presente nel repository; la variabile `AI_MODEL` resta facoltativa e non vanno mai inserite credenziali nel file. Workers AI è sempre remoto: anche l'uso locale può consumare quota.

## 7. Verifica manuale in browser

1. Avviare l'ambiente locale con `npm run dev -- --port 8788` e aprire `http://localhost:8788`.
2. Visitare `http://localhost:8788/api/status`: senza binding devono comparire `mode: "demo"`, `model: null` e `streaming: false`. Sono presenti i metadati `catalog` e `knowledge` (KB didattica); la chiave storica `rag` descrive anch'essa la KB didattica, non le challenge.
3. Nell'app, verificare che il badge indichi la modalità DEMO.
4. Verificare le tre aree: cronologia a sinistra, Training/libreria al centro, tutor a destra; comprimere e ripristinare il tutor senza perdere la chat.
5. Cliccare una card: deve aprirsi solo il drawer dei dettagli, senza aggiungere la challenge al contesto della chat.
6. Usare il pulsante **Chat** su più card: la selezione deve fermarsi a 6 challenge e la challenge cliccata per ultima deve comparire per prima nel contesto.
7. Premere **Nuova chat**: la chat deve essere generale anche se prima era selezionata una challenge; digitare un messaggio per verificare il titolo automatico, poi provare rinomina, riapertura ed eliminazione con conferma dalla cronologia.
6. Inviare una domanda generale (per esempio "Spiegami il boxing") e una contestuale (per esempio "Come posso iniziare?"): la risposta DEMO deve essere etichettata come tale e non deve contenere hint, flag o soluzioni.
7. Provare richieste esplicite di flag, soluzioni, writeup o payload: devono essere rifiutate lato server, prima della chiamata al modello, con `blocked: true`.
8. Provare domande teoriche con termini sensibili (`che cos'è una flag?`, `come funziona un payload HTTP?`): devono essere spiegazioni, non rifiuti. Una richiesta ambigua deve dare `needsClarification: true` senza `blocked: true`.
9. Incollare un estratto di consegna senza flag e chiedere `spiegami la consegna`: la risposta deve includere `intent: "explain_statement"`, `statementProvided: true` e `statementStatus: "user-provided"`; il campo visibile dev'essere svuotato dopo l'invio. L'estratto resta nei metadati della chat per i follow-up, non nei messaggi visibili, e non diventa una fonte verificata.
11. Verificare che una risposta con `**grassetto**`, `*corsivo*`, `\`codice\`` ed elenchi sia formattata, che `\*\*testo\*\*` diventi leggibile e che un tentativo di HTML non produca elementi eseguibili.
12. Dopo la verifica del binding `AI` e la ri-distribuzione, ripetere `/api/status`: devono comparire `mode: "ai"`, `streaming: true` e il modello `@cf/zai-org/glm-4.7-flash`, salvo override via `AI_MODEL`.
13. Inviare una domanda con `curl -N` (vedi `CLOUDFLARE.md`): la risposta deve essere `text/event-stream` con eventi `data:` muniti di `reply` cumulativo; l'ultimo evento deve contenere `mode`, `model`, `intent` e `sources`. Non è stato possibile eseguire questo passaggio senza binding e senza accesso alla dashboard.

## 8. Verifica automatica dei comportamenti v2

`tests/tutor-behavior-v2.test.mjs` esercita direttamente `onRequestPost` con un binding `AI` finto che registra modello e `input.messages`, oppure legge gli eventi SSE prodotti dall'handler. I 12 casi richiesti (consegna senza/ con estratto, CSRF, primo e secondo hint, ragionamento ambiguo e suo chiarimento, insistenza, manipolazione emotiva, messaggio personale, assenza di dettagli inventati e di indicazioni risolutive) sono mappati nel paragrafo «Verifica automatica» di [`TUTOR-BEHAVIOR.md`](TUTOR-BEHAVIOR.md). Il test 13 verifica che il client interpreti gli stessi metadati in JSON e SSE.

`tests/conversation-awareness.test.mjs` aggiunge 15 casi backend-driven: i follow-up obbligatori, la distinzione tra `requests.Session()` e `flask.session`, il chiarimento mirato senza contesto, l'elenco vuoto in JSON e SSE con rigenerazione limitata, la conversazione lunga con ancore, il blocco di un «continua» dopo un rifiuto, il retrieval contestuale e la propagazione dei nuovi metadati nel client. Anche qui il mock AI registra `input.messages`: le asserzioni verificano cioè il payload reale inviato al modello, non la sola presenza di parole nel prompt.

Le asserzioni riguardano il comportamento effettivo del backend: metadata di risposta, numero di chiamate al modello, separazione `system`/`user`, provenienza delle fonti KB, `hintStage`, rifiuti deterministici e sostituzione dell'output unsafe o incompleto nello streaming. Non verificano la qualità della risposta di un modello remoto: il binding `AI` effettivo non è stato usato in questa sessione.

`npm test`: **142 test passati**, inclusi `tests/branding.test.mjs`, `tests/markdown-ui.test.mjs`, `tests/tutor-context-flow.test.mjs` (stato consegna, cambio challenge, JSON/SSE) e `tests/workspace-history.test.mjs` (chat persistenti). Build locale: `npx wrangler pages functions build --outdir=/tmp/opencode/oliduck-functions-build-final` completata con Wrangler 4.168.0.

Per i dettagli dei limiti delle API e delle risposte di errore vedere [`README.md`](../README.md).

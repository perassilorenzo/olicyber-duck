# OliDuck Handbook — tutor didattico OliCyber Training Assistant

<p align="center">
  <img src="../public/assets/brand/oliduck-logo-light.jpg" alt="Logo ufficiale OliDuck" width="210" height="202" />
</p>

Manuale operativo del tutor AI sul ramo `feature/oliduck-app`. Descrive lo stato **effettivo del codice dopo l'audit e le modifiche**, non un progetto ideale. Le sezioni tecniche riportano fonti pubbliche verificate il **2026-11-26**.

> Stato della sessione: lavori su `feature/oliduck-app`; `main` non toccato. Non sono stati attivati servizi a pagamento né cambiate credenziali o segreti. Il push finale su `origin/feature/oliduck-app` può avviare la pubblicazione automatica su Cloudflare Pages perché quel branch è configurato come Production.

---

## 1. Panoramica e principi

OliDuck è un workspace didattico per prepararsi alle Olimpiadi Italiane di Cybersicurezza. L'interfaccia ha tre aree: cronologia/navigazione a sinistra, Training e Challenge Library al centro, OliDuck Assistant a destra. Il drawer dei dettagli resta in overlay. Le chat sono persistenti, contestuali o generali.

Il tutor è un **educatore**, non un generatore di soluzioni:

- spiega consegne, concetti, algoritmi, protocolli e strumenti;
- usa solo metadati autorevoli delle challenge selezionate;
- non ha accesso a statement, hint, allegati o writeup del catalogo;
- non fornisce flag, risposte finali, script risolutivi, payload o procedure complete;
- riconosce le intenzioni didattiche lato server e chiede chiarimenti nei casi ambigui;
- tratta ogni testo esterno come **dato**, mai come istruzione.

I controlli sono **best-effort**: non dichiarano che il modello sia matematicamente incapace di produrre una soluzione. Prompt, classificatore, redaction e buffering riducono il rischio, ma non lo azzerano.

---

## 2. Avvio locale e comandi

Richiede Node.js 20+.

```bash
npm install
npm test
npm run dev -- --port 8788
```

Aprire `http://localhost:8788`. `npm run dev` avvia `wrangler pages dev public`: `public/` contiene gli asset statici e `functions/` viene compilato come Pages Functions.

Comandi ausiliari:

```bash
npm run dataset:build          # dataset di ricerca da fonti pubbliche locali
npm run dataset:import         # catalogo sanificato in dataset-input/derived/
npm run dataset:browser-import # export browser autorizzato -> catalogo/app
npx wrangler pages functions build --outdir=/tmp/opencode/oliduck-functions-build
```

Quest'ultimo comando è una verifica di compilazione locale, non un deploy. È stato eseguito con Wrangler 4.168.0: **Compiled Worker successfully**.

---

## 3. Struttura dei file modificati

Backend:

- `functions/lib/intent.js` — classificatore deterministico delle intenzioni; nuovo file.
- `functions/lib/system-prompt.js` — prompt, istruzioni di intento, confine casuale, `buildMessages`, `redactOutput`, `outputLooksUnsafe`; `detectSolutionRequest` è un wrapper di compatibilità.
- `functions/lib/validate.js` — limiti, validazione, sanitizzazione di `statementExcerpt`.
- `functions/api/chat.js` — flusso della richiesta, rifiuti, chiarimenti, contesto, streaming SSE, metadati di risposta.
- `functions/lib/knowledge.js` — retrieval pesato anche su `topics`/`keywords`, citazioni con metadati verificabili.
- `functions/data/teaching-kb.json` — KB didattica riscritta e verificata.
- `functions/api/status.js` — espone anche `knowledge.reviewedAt`.

Frontend:

- `public/src/markdown.js` — renderer Markdown sicuro con DOM API; nuovo file.
- `public/src/assistant.js` — chat persistenti con contesto per conversazione, estratto consegna riutilizzato nei follow-up, streaming sicuro e annullamento.
- `public/src/history.js` — cronologia chat: nuova chat, apertura, rinomina, eliminazione con conferma; nuovo file.
- `public/src/training.js` — dashboard Training con statistiche reali e azioni rapide; nuovo file.
- `public/src/store.js` — metadati conversazione, preferenze (`assistantCollapsed`), API per chat multiple; `SCHEMA_VERSION = 2` invariato.
- `public/src/api.js` — invio di `statementExcerpt` e parsing di `intent`, `needsClarification`, `statementProvided`, `statementStatus`, `catalogVerified`, `contextMode`, `challengeCount`.
- `public/index.html` — shell a tre aree, UI dell'estratto consegna e logo ufficiale in header, pannello tutor, chat iniziale, indicatore di caricamento e dialog Informazioni.
- `public/styles/main.css` — layout a tre aree, collapse del tutor, overlay responsive, stili Markdown, estratto e asset del brand con `object-fit: contain`.

Test:

- `tests/tutor-behavior-v2.test.mjs` — 13 test: i 12 casi richiesti dalla rifinitura v2 più il parsing client dei metadati. Ogni caso esercita `onRequestPost` e verifica il modello/input catturati o gli eventi SSE, non solo stringhe nel codice.
- `tests/tutor-improvements.test.mjs` — casi storici 1-11, 13, 14.
- `tests/markdown-ui.test.mjs` — caso 12 (Markdown sicuro).
- `tests/branding.test.mjs` — integrità del logo ufficiale e dei collegamenti alle icone.
- `tests/tutor-context-flow.test.mjs` — 4 test: stato consegna strutturato, metadati JSON/SSE, cambio challenge con contesto primario, parsing client.
- `tests/workspace-history.test.mjs` — cronologia chat, titoli automatici, nuova chat generica, contesto riaperto, estratto persistente, eliminazione con conferma e collapse del tutor.
- `tests/ui.test.mjs` — struttura a tre aree e semantica "primary first" della selezione challenge.

Script:

- `scripts/build-dataset.mjs` — scrittura atomica degli output per evitare race tra processi che rigenerano il dataset.

Documentazione:

- `README.md`, `docs/CLOUDFLARE.md`, `docs/AI-ARCHITECTURE.md`, `docs/TUTOR-BEHAVIOR.md`, questo handbook.

### Asset del brand

Il JPG fornito come riferimento ufficiale è conservato senza modifiche in `public/assets/brand/oliduck-logo-original.jpg`. Dallo stesso file sono state derivate versioni ottimizzate, tutte con proporzioni invariate:

- `oliduck-logo-lockup.png` / `.webp` — lockup completo con sfondo reso trasparente; usato in header, chat iniziale e dialog Informazioni.
- `oliduck-logo-light.jpg` — ritaglio con sfondo chiaro, usato in README e documentazione per restare leggibile anche in modalità scura di GitHub.
- `oliduck-logo-mark.png` / `.webp` — solo simbolo, usato nel pannello tutor e nell'indicatore di caricamento.
- `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` — icone derivate dal simbolo.

Non esistono schermate di login o registrazione: non sono state quindi aggiunte. Il vecchio `favicon.svg` resta come fallback storico.

---

## 4. API `GET /api/status`

Senza `env.AI` effettivo:

```json
{
  "mode": "demo",
  "model": null,
  "streaming": false,
  "note": "Binding AI non configurato: il backend risponde in modalità DEMO.",
  "catalog": { "status": "imported-partial", "verified": false, "imported": 735 },
  "knowledge": {
    "connected": true,
    "documents": 20,
    "chunks": 20,
    "reviewedAt": "2026-11-26",
    "policy": { "derivedFromChallengeExport": false }
  }
}
```

Con binding effettivo: `mode: "ai"`, `model` impostato (default `@cf/zai-org/glm-4.7-flash`, salvo `AI_MODEL`) e `streaming: true`. La chiave storica `rag` descrive la KB didattica, non le challenge dell'export browser.

---

## 5. API `POST /api/chat`

Richiesta:

```json
{
  "challengeIds": ["olicyber-1"],
  "message": "Spiegami la consegna",
  "history": [{ "role": "user", "content": "Ho letto il testo" }],
  "statementExcerpt": "Testo incollato dallo studente"
}
```

- `challengeIds`: massimo 6; il client invia solo ID.
- `message`: massimo 4.000 caratteri.
- `history`: massimo 12 messaggi / 8.000 caratteri.
- `statementExcerpt`: facoltativo, massimo 2.000 caratteri; non inviare flag o soluzioni.
- `challenge`: se inviato, viene ignorato.

Risposta JSON o ultimo evento SSE include `reply`, `mode`, `model`, `challengeIds`, `challengeId` (o `general`), `intent`, `statementProvided`, `sources`, `statementStatus` (`unavailable`, `partial`, `user-provided`, `verified`), `catalogVerified`, `contextMode` (`general`, `single`, `multi`) e `challengeCount`; quando pertinenti anche `statementMissing`, `needsClarification`, `hintStage`, `personalContext` e `support`. In caso di rifiuto: `blocked: true`. In caso di ambiguità: `needsClarification: true` e nessun `blocked: true`. Errori: `400`, `403`, `413`, `415`, `429`, `502`, `503`, `504`.

Con il binding attivo la risposta è `text/event-stream`: ogni evento ha `reply` **cumulativo** e autorevole, non un delta. Il client accetta ancora il vecchio campo `token` per compatibilità.

---

## 6. Intenti didattici

`functions/lib/intent.js` classifica il messaggio corrente senza chiamare il modello:

| Intento | Comportamento |
| --- | --- |
| `explain_statement` | Spiega cosa viene chiesto, dati noti e termini tecnici, senza procedura risolutiva. |
| `explain_concept` | Spiegazione teorica, nessuna risoluzione di challenge. |
| `request_hint` | Primo indizio mirato e domanda di verifica. |
| `review_reasoning` | Valuta il metodo dello studente e fa una domanda mirata. |
| `request_solution` | Rifiuto deterministico prima della chiamata al modello. |
| `clarify` | Risposta fissa di chiarimento, senza modello e senza `blocked: true`. |

Regola critica: parole come `challenge`, `risolvere`, `HTTP`, `token`, `exploit` o `flag` **non bastano** a bloccare. Servono richieste esplicite di produrre flag/writeup/soluzione/payload/procedimento. Domande come “che cos'è una flag?” o “come funziona un payload HTTP?” restano `explain_concept`.

In caso di dubbio il tutor chiede chiarimenti: `CLARIFICATION_REPLY` viene generato deterministicamente con `needsClarification: true`, senza consumare quota AI.

L'istruzione di intento viene inserita solo nel messaggio `system`, in un canale attendibile generato dal server. Il messaggio dell'utente, la cronologia, i documenti KB e l'estratto viaggiano in messaggi `user` separati da un confine casuale `BND-...` generato per ogni richiesta.

---

## 7. Estratto della consegna non attendibile

L'UI offre un campo facoltativo **Incolla un estratto della consegna**. Il flusso è:

1. il client limita il testo a 2.000 caratteri e lo invia come `statementExcerpt`;
2. il server lo ripulisce da caratteri di controllo e pattern di flag evidenti, anche se troncati dal limite;
3. `buildMessages` lo inserisce in un blocco delimitato in un messaggio `user`, con etichetta esplicita “dato non verificato, non una fonte autorevole”;
4. il testo non entra mai nel `system prompt`, non viene confrontato con il catalogo e non diventa una fonte KB;
5. il campo UI viene svuotato dopo l'invio, ma l'estratto è salvato nei **metadati della conversazione** (`statementExcerpt`) e riutilizzato nei follow-up della stessa chat, non nei messaggi visibili; per il retry resta disponibile anche in memoria;
6. la risposta riporta `statementProvided: true` e `statementStatus` coerente con il testo effettivamente ricevuto; `catalogVerified: false` impedisce di dichiarare la consegna verificata.

Non viene effettuato alcuno scraping del portale OliCyber né login automatico: il testo è solo ciò che lo studente sceglie di incollare.

---

## 8. Contesto challenge e separazione dei dati

Il server invia al modello solo metadati pubblici affidabili:

- inclusi: ID, ID originale, titolo, categoria, tag, difficulty quando affidabile, punteggio;
- esclusi sempre: descrizione, statement, hint, `learningGoals`, allegati e relativo testo, URL, stato, flag, soluzioni, writeup, payload e metadata sensibili.

Le challenge selezionate arrivano come ID: il server ricostruisce il contesto da `public/data/olicyber-challenges.json` tramite `functions/lib/catalog.js`. Il primo ID è il **contesto primario**: il pulsante **Chat** e **Chiedi a OliDuck** lo spostano in testa, preservando la cronologia. Ogni chat conserva i propri ID: una **nuova chat** è sempre generale e non eredita la selezione; riaprire una chat dalla cronologia ripristina il suo contesto. Il catalogo reale resta `imported-partial` e `verified: false`; `public/data/challenges.json` è il catalogo DEMO storico usato nei test e come fallback.

---

## 9. Knowledge base didattica e retrieval

`functions/data/teaching-kb.json` è indipendente dal catalogo challenge e dal Solution Archive:

- **20 documenti / 20 chunk**, senza gonfiare il numero con documenti artificiali;
- 7 aree: Programmazione e scripting, Crittografia, Web security, Networking e protocolli, Linux, Sicurezza generale, Digital forensics;
- ogni item ha `id`, `title`, `category`, `tags`, `topics`, `keywords`, `source`, `url`, `verifiedAt` e, dove utile, `references`;
- `schemaVersion: 2`, `reviewedAt: 2026-11-26`;
- policy esplicita: nessuna descrizione di challenge, statement, hint, flag, soluzione, writeup, payload o allegato; nessuna derivazione dall'export challenge.

Il retrieval di `functions/lib/knowledge.js` è deterministico e pesa titolo, argomenti/parole chiave, tag e testo. `knowledgeContext` include fonte, URL e data di verifica. `publicKnowledgeSources` restituisce solo metadati: il testo dei documenti e gli snippet non sono esposti alle API.

L'indice `functions/data/rag-index.json` generato dall'export browser è **legacy** e non usato a runtime. La KB autorizzata di `dataset-input/rag-index.json` resta vuota (0 documenti) perché il gate di pubblicazione è `DENY` by default e i writeup non sono autorizzati per il tutor.

---

## 10. Fonti e correzioni tecniche

Fonti istituzionali e standard verificati:

- OliCyber: `https://www.olicyber.it/`, `/organizzazione`, `/materiale`; portale di allenamento `https://training.olicyber.it/`; `https://www.cyberchallenge.it/`; CINI `https://www.consorzio-cini.it/`; Cybersecurity National Lab `https://cybersecnatlab.it/`.
- Repository ufficiale `https://github.com/OliCyberIT/OliCyber.IT-Writeups`: writeup ufficiali con licenza GPL-3.0. Sono soluzioni: **non entrano nella KB del tutor**.
- Standard tecnici: NIST FIPS 180-4 Update 1 e NIST Hash Functions; RFC 2104 (HMAC); RFC 9106 (Argon2id); RFC 7914 (scrypt); OWASP Password Storage Cheat Sheet; RFC 5246 (TLS 1.2); RFC 8446 (TLS 1.3); RFC 5280 (X.509/PKIX); RFC 5869 (HKDF); RFC 5116 (AEAD); OWASP CSRF Prevention Cheat Sheet.

Correzioni applicate ai contenuti didattici:

- hashcritografico: digest a lunghezza fissa, determinismo, collision/preimage resistance; è integrità, non riservatezza e non si “decifra”;
- HMAC: combina hash e chiave segreta (`ipad = 0x36`, `opad = 0x5C`) e fornisce integrità/autenticazione, non solo rilevamento di modifiche casuali;
- password: non usare hash veloci come SHA-256; sale unica, Argon2id come scelta primaria, scrypt alternativa, bcrypt storica con limite 72 byte;
- TLS 1.2: premaster RSA o Diffie-Hellman secondo RFC 5246; SSLv3 non va negoziato;
- TLS 1.3: scambi `(EC)DHE`, `PSK-only` o `PSK con (EC)DHE`, key schedule HKDF, solo AEAD; **non usa lo scambio RSA della Pre-Master Secret** e offre forward secrecy;
- CSRF: cookie con HttpOnly/Secure/SameSite, token imprevedibili o Signed Double-Submit, Fetch Metadata, controlli Origin/Referer; XSS può vanificare le difese CSRF.

Non è stata affermata alcuna collaborazione, accordo o autorizzazione ufficiale da parte di OliCyber/CINI/ACN.

---

## 11. Modello, streaming SSE e costi

Modello predefinito invariato: `@cf/zai-org/glm-4.7-flash` (GLM-4.7-Flash), centralizzato in `functions/lib/model.js`.

Payload lato server:

```js
{
  messages,
  max_completion_tokens: 700,
  temperature: 0.35,
  stream: true,
  chat_template_kwargs: { enable_thinking: false }
}
```

Workers AI produce SSE con `choices[0].delta.content` e terminatore `data: [DONE]`. Il backend non espone `reasoning_content`. Il team di sviluppo ha consultato la documentazione Cloudflare il 2026-11-26: contesto 131.072 token, ZDR, prezzo indicativo $0.0605/M token di input e $0.40/M di output; la tabella pricing riporta 5.500 e 36.400 Neurons/M.

Quota giornaliera e costi dipendono dall'account: la documentazione indica 10.000 Neurons/giorno di allocazione gratuita, $0.011 per 1.000 Neurons oltre soglia sui piani Paid e azzeramento alle 00:00 UTC. **Nessun servizio a pagamento è stato attivato in questa sessione** e non è stata eseguita alcuna chiamata reale al modello.

---

## 12. Sicurezza input/output e limiti

| Controllo | Effetto | Limite |
| --- | --- | --- |
| Classificatore lato server | Rifiuta solo richieste esplicite di soluzione; ambiguità -> chiarimento | Best-effort |
| System prompt con confine casuale | Dati separati dalle istruzioni | Non elimina ogni prompt injection |
| Limiti di richiesta | 4.000 char messaggio, 12/8.000 char cronologia, 16.000 byte body, 6 challenge, 700 token, 20 s | Validati lato server |
| Redaction output | Rimuove pattern di flag | Best-effort |
| Streaming con finestra | Ultimi 64 char in buffer; testo cumulativo rivalutato | Best-effort |
| Rate limiter | 429 con `Retry-After` per isolato | Non distribuito |
| Origin check | Blocca richieste cross-origin con `Origin` diverso | Difesa di base, non anti-abuso |
| Binding `AI` | Nessuna API key nel repository/frontend | Binding remoto da verificare |

In produzione affiancare Cloudflare WAF / Rate Limiting Rules sul path `/api/chat`, Bot Fight Mode o Turnstile in caso di abuso e monitoraggio con Workers Logs/Logpush. I dettagli interni degli errori del provider non sono esposti al client.

---

## 13. Rendering Markdown sicuro

`public/src/markdown.js` costruisce sempre nodi DOM con `createElement`, `createTextNode`, `append` e `replaceChildren`: **nessun `innerHTML` per contenuti del modello**.

Supporta:

- paragrafi, intestazioni, elenchi ordinati e non, citazioni;
- blocchi di codice con linguaggio validato;
- grassetto, corsivo, codice inline, link HTTPS;
- normalizzazione di escape letterali come `\*\*testo\*\*`, che diventa leggibile come grassetto.

Sicurezza:

- link con protocollo diverso da HTTPS, relativi o con credenziali incorporate restano testo;
- attributi `rel="noopener noreferrer nofollow"` e `target="_blank"`;
- HTML ostile in blocchi di codice resta testo;
- messaggi dell'utente restano testo plain; solo i messaggi assistant usano il renderer;
- dots di typing generati con `createElement`, non `innerHTML`.

---

## 14. Dataset, import e provenienza

Le tre sezioni restano separate:

1. **Challenge Catalog**: metadati e descrizioni derivate, non autorizzato per il tutor;
2. **Learning Knowledge Base**: solo documenti ammessi dal gate; oggi 0 nel dataset pubblico;
3. **Solution Archive**: writeup, script e materiale non verificato, `restricted: true`, mai indicizzato per il tutor.

Il builder non esegue file delle fonti, non estrae archivi e non fa rete. La mappa `PUBLICATION_OVERRIDES` resta vuota: la provenienza di una repository non è un'autorizzazione. Gli output sono deterministici: `generatedAt` deriva dai commit delle fonti, non dall'ora corrente.

È stata aggiunta la scrittura atomica (file temporaneo + `renameSync`) per `manifest.json`, `catalog.json`, `rag-index.json`, `import-report.json` e `REPORT.md`: evita che test eseguiti in processi diversi leggano file parziali durante la rigenerazione.

---

## 15. Cloudflare: configurazione e stato reale

`wrangler.toml` contiene:

```toml
[ai]
binding = "AI"
```

Il blocco è già presente in `HEAD`. Non equivale a dire che il progetto Pages distribuito abbia il binding: per l'ambiente remoto occorre verificare/aggiungere **Workers AI** con variabile `AI` in Dashboard → Workers & Pages → progetto → Settings → Bindings, poi ridistribuire.

Stato della sessione:

- nessun accesso alla dashboard Cloudflare;
- binding remoto **non verificato**;
- nessun deploy;
- nessun test modello reale o quota remota;
- test solo con mock SSE o ambienti senza `env.AI`.

Workers AI è sempre remoto e può consumare quota anche in sviluppo locale: usare il modello reale solo consapevolmente. `AI_MODEL` è un override facoltativo; non inserire token o API key nel repository.

---

## 16. Verifiche eseguite

- `npm test`: **127 test, 127 passati, 0 falliti**.
- `node --test tests/tutor-behavior-v2.test.mjs`: **13 test, 13 passati**, che coprono i 12 casi della rifinitura v2 e il parsing client dei metadati.
- `node --test tests/tutor-context-flow.test.mjs`: **4 test, 4 passati** (stato consegna, JSON/SSE, cambio challenge, parsing client).
- `node --test tests/workspace-history.test.mjs`: **1 test, passato** (cronologia e collaborazione delle aree).
- `tests/branding.test.mjs`: passato: logo originale e derivate presenti, proporzioni invariate e collegamenti ancora presenti in header, README, documentazione, chat iniziale, pannello tutor e icone.
- `tests/markdown-ui.test.mjs`: passato: Markdown sicuro con escape normalizzati e nessun HTML iniettato.
- `git diff --check`: nessun errore (verifica finale ripetuta dopo la stesura di questa sezione).
- `npx wrangler pages functions build --outdir=/tmp/opencode/oliduck-functions-build-final` con Wrangler 4.168.0: **Compiled Worker successfully**.
- Controlli ad hoc su KB: 20 documenti/20 chunk, assenza di `flag{`, `olicyber-`, lowercase `writeup`/`payload`, retrieval corretto per hash/TLS/CSRF/Argon2id/TCP/forensica.
- Verifica del determinismo del builder: ripetizioni e suite completa senza mismatch di hash.

Non sono stati eseguiti: verifica visiva reale in browser alle larghezze 1440/1280/768/390 px, ispezione console/network reale, test modello remoto, deploy. I test UI usano JSDOM: verificano struttura, interazioni e asserzioni funzionali, non il rendering visivo. Restano da fare manualmente: resize delle colonne, overlay Training/history su schermi stretti, collapse del tutor, indicazione dei confini e leggibilità dei testi.

---

## 17. Limiti noti e non risolti

- Catalogo reale `imported-partial`, `verified: false`; completezza non verificata (738 scoperti, 735 importati).
- Binding AI dichiarato nel repository ma non verificato remote.
- Nessuna verifica di modello reale, streaming remoto o quota effettiva.
- Rifiuti e redaction sono best-effort: non garantiscono l'assenza matematica di soluzioni.
- Rate limiter in memoria per isolato: non è un limite globale distribuito.
- Markdown renderer è un sottoinsieme deliberato, non un parser completo.
- L'estratto consegna non è una fonte verificata e può essere incompleto o fuorviante; resta associato alla chat anche dopo l'invio.
- Verifica visiva responsive e console/network reali non eseguite: i controlli JSDOM non sostituiscono un browser.
- Nessun accordo ufficiale con OliCyber/CINI/ACN è stato verificato o dichiarato.

---

## 18. Prossime attività consigliate

1. Verificare in dashboard il binding `AI` del progetto Pages e solo dopo, su autorizzazione esplicita, distribuire.
2. Eseguire una sessione manuale in browser con le verifiche descritte in `AI-ARCHITECTURE.md` (inclusa la nuova UI a tre aree e la cronologia chat) e con la rifinitura v2 mappata in `TUTOR-BEHAVIOR.md`.
3. Monitorare quota e costi Workers AI; valutare WAF/Rate Limiting Rules/Turnstile per esposizione pubblica.
4. Mantenere la KB aggiornata con nuove date di verifica quando cambiano standard o guide OWASP/NIST.
5. Non importare mai writeup o materiale di soluzione nella KB autorizzata senza revisione umana, licenza verificata e gate esplicito.

# OliDuck — Audit sicurezza e qualità della Knowledge Base RAG

Stato: **audit completato e bonifica applicata**. Le correzioni alla pipeline e agli artifact del dataset sono state implementate nella Fase 2; il dettaglio è nella sezione 10 e in [`REMEDIATION-REPORT.md`](REMEDIATION-REPORT.md). Workers AI non è stato attivato, il frontend e `public/data/` non sono stati modificati, nessun dato è stato pubblicato o caricato su Cloudflare, nessun file sorgente o allegato è stato eseguito e l'archivio ZIP non è stato estratto.

Branch: `feature/oliduck-app` — commit esaminato nell'audit: `202bfe1` — audit versionato in `c43e3ab`.
Le sezioni 1–9 conservano lo stato **pre-bonifica** come evidenza storica dell'audit; la sezione 10 descrive lo stato corrente.

Nota successiva: l'integrazione dell'export browser ha introdotto `public/data/olicyber-challenges.json` e l'indice RAG runtime `functions/data/rag-index.json`. Le affermazioni del presente audit su `public/data/challenges.json` si riferiscono allo storico dataset di fonti pubbliche; lo stato attuale dell'app è descritto in [`../README.md`](../README.md) e [`../docs/CATALOG-IMPORT.md`](../docs/CATALOG-IMPORT.md).

---

## 1. Architettura esaminata (pre-bonifica)

### 1.1 Generazione degli artifact

`scripts/build-dataset.mjs` legge esclusivamente le directory locali in `dataset-input/sources/` e produce:

| File | Ruolo |
| --- | --- |
| `dataset-input/catalog.json` | Tre sezioni separate: `challengeCatalog`, `learningKnowledgeBase`, `solutionArchive`. |
| `dataset-input/rag-index.json` | Indice dei chunk derivati **solo** da `learningKnowledgeBase`. |
| `dataset-input/manifest.json` | Inventario file-level con hash, licenza, leggibilità, duplicati, ruolo e riferimenti. |
| `dataset-input/import-report.json` | Conteggi, limiti e verifiche finali. |
| `dataset-input/REPORT.md` | Report umano dei risultati. |

`scripts/import-dataset.mjs` converte solo `challengeCatalog` in un catalogo applicativo v2 sanificato. Di default scrive in `dataset-input/derived/`; `public/data/` viene toccato solo con `--apply` esplicito. Il `solutionArchive` non attraversa mai questo importatore.

### 1.2 Costruzione dei chunk

Parametri in `scripts/build-dataset.mjs`:

- `CHUNK_SIZE = 1100` caratteri;
- `CHUNK_OVERLAP = 140` caratteri;
- normalizzazione degli spazi prima del taglio;
- taglio all'ultimo spazio dopo metà finestra, quando possibile;
- `chunkIndex`, `totalChunks`, `charStart`, `charEnd` conservati in ogni chunk;
- `retrievalKeys` con `challengeId`, `title`, `category`, `edition`, `source`, `docType`;
- `sourceRefs` non vuoti per costruzione.

Risultato osservato: **1125 documenti KB e 1125 chunk**. Ogni documento genera esattamente un chunk (`totalChunks = 1`). Lunghezze: min 78, max 776, media 171 caratteri. Non esistono quindi chunk multipli per documento e l'overlap non viene applicato nella pratica.

### 1.3 Composizione della KB

| `docType` | Documenti | Origine |
| --- | ---: | --- |
| `challenge-overview` | 465 | Metadati della challenge: titolo, categoria, edizione, autore, elenco delle fonti. |
| `concept-index` | 432 | Concetti tecnici rilevati per pattern nelle fonti. |
| `derived-context` | 228 | Primo paragrafo estratto da writeup ufficiali o blocchi citati da soluzioni community. |
| `learning-material` | 0 | Previsto dal codice ma mai prodotto: vedi finding **A6**. |

Distribuzione licenze nella KB: **459 GPL-3.0**, **666 non verificata**.

Riferimenti di provenienza presenti nei documenti KB (conteggi per occorrenza di riferimento, non per file unico):

| Tipo riferimento | Occorrenze |
| --- | ---: |
| `official-writeup` | 768 |
| `community-solution` | 403 |
| `official-index` | 304 |
| `edition-index` | 262 |

### 1.4 Stato del runtime

Il tutor effettivamente distribuito non usa ancora la KB:

- `functions/api/chat.js` costruisce il contesto solo tramite `functions/lib/catalog.js`;
- `functions/lib/catalog.js` importa `public/data/challenges.json`, che è il catalogo demo `unverified-demo` (7 challenge, tutte `demo: true`);
- il campo `challenge` inviato dal client viene ignorato da `functions/lib/validate.js`: il server ricostruisce il contesto solo da `challengeId`;
- `system-prompt.js` inserisce dati non attendibili in messaggi delimitati da un confine casuale e vieta esplicitamente flag, soluzioni e step-by-step completi;
- non esistono riferimenti runtime a `rag-index.json`, `learningKnowledgeBase`, `solutionArchive` o `dataset-input` in `functions/`, `public/src/`, `public/index.html` o `wrangler.toml`;
- `wrangler.toml` ha il binding `[ai]` commentato: senza `env.AI` l'handler risponde in modalità DEMO.

Quindi, allo stato attuale, **nessun chunk RAG raggiunge il modello o il client**. L'audit riguarda il rischio potenziale una volta attivata una futura implementazione RAG.

---

## 2. Fonti effettivamente utilizzate

| Directory | Repository | Commit | `committedAt` | Licenza dichiarata |
| --- | --- | --- | --- | --- |
| `official-writeups` | `https://github.com/OliCyberIT/OliCyber.IT-Writeups` | `0d1ac26e3cc01c0ba85ab25d04cf1ece4548fa63` | `2026-03-25T15:27:23+01:00` | GPL-3.0 (`LICENSE`) |
| `community-solutions` | `https://github.com/Privitorta/Training-OliCyber.IT-solutions` | `081b0fef425b91e6ee34352643cbb9e5a1aac50d` | `2025-11-15T23:57:10+01:00` | **nessuna licenza dichiarata** |

La data di generazione `2026-03-25T15:27:23+01:00` è il commit più recente tra le due fonti, non un timestamp di esecuzione del builder. È deterministico e corretto come "snapshot delle fonti", ma fuorviante se letto come data di build (finding **A7**).

Inventario: 444 file totali, di cui 386 di contenuto e 58 metadati `.git/`. Ruoli: 154 writeup ufficiali, 179 soluzioni community, 37 allegati, 16 documentazione, 58 metadati repository. 42 file non sono leggibili come UTF-8 (34 di contenuto); 1 ZIP è inventariato ma non estratto.

---

## 3. Problemi rilevati

| ID | Gravità | Finding | Evidenza (pre-bonifica) | Correzione / esito (Fase 2) |
| --- | --- | --- | --- | --- |
| **A1** | Alta | `derived-context` contiene indizi risolutivi, non solo contesto descrittivo. | 228 chunk `derived-context`; 162 derivano da `official-writeups/`. Una scansione semantica ha individuato almeno 13 chunk con indicazioni operative esplicite, es. `oc-2021-nazionale-144` ("La flag viene checkata utilizzandola come input di un sudoku"), `oc-2021-nazionale-145` (decifratura quattro caratteri alla volta), `oc-2021-nazionale-147` (necessità di ottenere RCE), `oc-2023-camp-3-393` (richiesta HTTP con metodo custom), `oc-2023-territoriale-401` (presenza di una `win function`). | Escludere `derived-context` dal RAG finché non è revisionato. Se necessario, creare una classe `reviewed-hint` con testo riscritto a mano, senza passaggi operativi, e mai etichettato come descrizione ufficiale. |
| **A2** | Alta | `challenge-overview` inserisce nel testo del chunk l'elenco dei percorsi sorgente, inclusi writeup e soluzioni. | 465/465 chunk `challenge-overview` contengono la riga `Fonte: ...`; 460/465 contengono percorsi `official-writeups/`, `community-solutions/`, `writeup` o `solution`. | Non serializzare `sourceRefs` nel testo del chunk. Tenere i percorsi solo nei campi strutturati usati per le citazioni, e mostrare all'utente solo metadati autorizzati. |
| **A3** | Alta | La KB contiene 666 chunk con licenza non verificata, derivati dalla repository community senza LICENSE. | `ragLicenses`: 459 GPL-3.0, 666 non verificata. | Aggiungere un gate `licenseVerified === true && tutorAllowed === true` prima di indicizzare o distribuire l'indice. Non caricare `rag-index.json` su Cloudflare finché non c'è autorizzazione esplicita. |
| **A4** | Media | La redaction corrompe i percorsi delle fonti dentro il testo dei chunk. | 8 chunk contengono `[TOKEN_RIMOSSO]` dentro la riga `Fonte:`, es. `community-solutions/Olimpiadi-Italiane-di-[TOKEN_RIMOSSO].py`. Il regex `[A-Za-z0-9+/]{48,}` include `/` e interpreta lunghi segmenti di percorso come token base64. I campi strutturati `source`/`sourceRefs` restano corretti. | Applicare redaction solo al testo libero, non ai metadati; restringere il regex escludendo `/`; aggiungere un test che verifichi che ogni percorso in `Fonte:` sia identico a un `sourceRefs[].path`. |
| **A5** | Media | Il placeholder di redaction diventa `[FLAGRIMOSSA]` invece di `[FLAG_RIMOSSA]`. | `redact()` produce `[FLAG_RIMOSSA]`, poi `cleanMarkdown()` rimuove `_`. Risultato: 2 occorrenze in KB/RAG e 4 nell'intero `catalog.json`. | Eseguire `cleanMarkdown()` prima di `redact()`, oppure usare un placeholder senza underscore, e aggiungere un'asserzione sul formato atteso. |
| **A6** | Media | Nessun documento `learning-material` è presente, pur essendo previsto dal codice. | `roleOf()` verifica `rel.startsWith('Introduzione/')`, ma i percorsi includono il prefisso `community-solutions/`. I file `community-solutions/Introduzione/...` sono classificati come `community-solution` e finiscono nel Solution Archive. | Calcolare il percorso relativo alla repository prima di applicare il prefisso, es. `rel.slice(repo.length + 1).startsWith('Introduzione/')`. Inserire in KB solo dopo verifica licenza e contenuto didattico effettivo. |
| **A7** | Bassa | `generatedAt` è l'ultimo commit delle fonti, non la data di esecuzione. | `2026-03-25T15:27:23+01:00` coincide con `committedAt` di `official-writeups`. | Rinominare in `sourceSnapshotAt`; se serve una data di build, aggiungere un campo separato accettando la perdita di determinismo bitwise. |
| **A8** | Media | Lo schema non ha una classificazione esplicita coerente con le categorie richieste. | `docType` descrive provenienza/formato (`challenge-overview`, `derived-context`, `concept-index`), non "Descrizione ufficiale / Materiale didattico / Writeup ufficiale / Soluzione community / Allegato / Derivato". | Aggiungere `classification`, `tutorAllowed`, `reviewStatus`, `publicExposure`, `restricted`. Usare questi campi come gate di retrieval. |
| **A9** | Media | Il catalogo applicativo derivato mette il testo derivato in `description` e `statement` senza etichetta nel testo visibile. | `import-dataset.mjs` copia `description.derived.text` in `description`/`statement`; l'etichetta resta solo in `metadata.descriptionProvenance` e `provenance.status`. | Prefissare il testo con "Descrizione derivata, non ufficiale" oppure passare un campo separato `derivedDescription` e lasciare `description` vuoto. |
| **A10** | Media | Le difese anti-flag dell'importatore sono troppo strette. | `import-dataset.mjs` blocca solo `/flag\s*\{/` e chiavi chiamate `flag`/`solution`/`writeup`. Non blocca formati come `ITASEC{...}` né placeholder deformati come `[FLAGRIMOSSA]`. | Ampliare i pattern a `ITA`, `ITASEC`, `CTF`, `OliDuck`, forme con parentesi quadre, evalidare che i placeholder siano intatti. Mantenere un allowlist esplicita per i soli formati dichiarati e labelizzati. |
| **A11** | Alta | I flag sono inclusi nel `catalog.json` consegnato, dentro `solutionArchive`. | `challengeCatalog`, `learningKnowledgeBase`, `rag-index.json` e `derived/application-catalog.json` non contengono `flag{`; `solutionArchive` contiene writeup/soluzioni complete con flag reali. I campi `exposePublicly: false` e `cloudflareUploadAllowed: false` sono dichiarativi, non applicati dal filesystem. | Tenere l'archivio fuori da ogni artifact distribuibile e, se il repository è pubblico, fuori dal repository o in area con accesso controllato. Non aggiungere `dataset-input/` a `public/` o a deploy Pages. |
| **A12** | Bassa | La stabilità degli ID community è legata al percorso, non a un'identità semantica. | ID ufficiali `oc-<edizione>-<id>` sono stabili; ID community `cs-<evento>-<titolo>` cambiano se cambia il percorso o il titolo. 13 soluzioni sono agganciate con evidenza esplicita; 0 casi ambigui rilevati. | Mantenere ID correnti ma aggiungere una tabella di alias/identità stabile per i record community, con catene di provenienza e revisione umana. |

Nota: la verifica `noFlagsInCatalogOrKb` del builder serializza solo `{ challenges, kbDocuments }`, non l'intero `catalog.json`. È quindi corretta per il suo scopo, ma non deve essere letta come "nessuna flag nel file catalog.json".

---

## 4. Rischi di esposizione delle soluzioni

### 4.1 Frontend

Nessun file in `public/` carica `rag-index.json`, `catalog.json` del dataset o `solutionArchive`. `public/data/challenges.json` resta il catalogo demo `unverified-demo`. **Rischio attuale: nessuna esposizione diretta tramite frontend.**

### 4.2 API pubbliche

`POST /api/chat` accetta `challengeId`, messaggio e cronologia; non accetta testi di challenge dal client e non legge il dataset. Il contesto deriva solo da `public/data/challenges.json`. **Rischio attuale: nessuna esposizione tramite API.**

### 4.3 Contesto del tutor

Oggi non c'è retrieval: `buildMessages()` riceve solo il contesto del catalogo demo. **Rischio attuale: nessuna soluzione entra nel prompt.**

Rischio futuro se si collegasse `rag-index.json` senza gate:

- i 228 chunk `derived-context` contengono testo tratto da writeup/soluzioni;
- 13 di essi contengono indizi operativi forti (finding **A1**);
- la riga `Fonte:` dei chunk `challenge-overview` rivela a quali file di soluzione guardare (finding **A2**);
- 666 chunk non hanno licenza verificata (finding **A3**).

Un chunk singolo, nella maggior parte dei casi, non contiene una soluzione completa end-to-end. Tuttavia alcuni chunk contengono l'intuizione decisiva o un passo operativo preciso: questo è sufficiente per eludere la progressione didattica del tutor anche senza stampare una flag. In combinazione con i percorsi sorgente, il rischio diventa "indirizzare lo studente alla soluzione completa", non solo "dare un hint".

### 4.4 Cloudflare e licenze

`pages_build_output_dir = "public"`: `dataset-input/` non viene distribuito. Il binding AI è commentato. Nessun contenuto è stato caricato.

Resta un rischio procedurale: se una futura implementazione importasse `rag-index.json` in un bundle o in KV/D1 senza gate di licenza, 666 chunk non verificati verrebbero distribuiti. La repository community non dichiara alcuna licenza: non è lecito presumere autorizzazione di pubblicazione, indicizzazione o trasferimento a Cloudflare.

### 4.5 Archivio ristretto

348 documenti `solutionArchive` sono marcati `restricted: true`, `exposePublicly: false`, `cloudflareUploadAllowed: false`. Contengono testi di soluzione e flag reali. Questi flag sono correttamente assenti da catalogo applicativo, KB e RAG, ma presenti nel file `dataset-input/catalog.json` consegnato: le flag di restrizione non sono un controllo di accesso.

---

## 5. Qualità dei chunk

### Punti positivi

- ID deterministici e univoci (`kb-overview-*`, `kb-context-*`, `kb-concepts-*`).
- Ogni chunk ha `sourceRefs` non vuoti; 0 riferimenti mancanti rispetto al manifest.
- `retrievalKeys` consente filtri per challenge, titolo, categoria, edizione, fonte e tipo.
- Ogni chunk `derived-context` contiene esplicitamente la frase `NON descrizione ufficiale`.
- Nessuna flag letterale `flag{` in `challengeCatalog`, `learningKnowledgeBase`, `rag-index.json` o catalogo applicativo derivato.
- Nessun chunk ha `docType` di writeup, soluzione o allegato.

### Limiti

- Un solo chunk per documento: nessuna suddivisione semantica, nessun overlap effettivo.
- Il testo di `challenge-overview` mescola metadati e percorsi sorgente (finding **A2**).
- I concetti sono estratti da regex su testi di soluzione: sono "concetti citati nelle fonti", non una tassonomia didattica verificata.
- La redaction modifica alcuni percorsi e placeholder (finding **A4**, **A5**).
- Un formato flag-like `ITASEC{...}` è presente come "formato della flag" in un contesto derivato: non è una flag vera, ma può essere interpretato come tale dal modello.
- Non esiste punteggio di qualità, revisione umana, data di validazione o stato di autorizzazione per singolo chunk.
- Non esiste un campo che distingua "hint didattico approvato" da "testo derivato da soluzione".

---

## 6. Contenuti utilizzabili dal tutor

| Categoria | Utilizzabile dal tutor? | Condizioni |
| --- | --- | --- |
| Materiale didattico autorizzato | **Da verificare** | Oggi 0 documenti `learning-material` per il finding **A6**. Richiede licenza verificata, contenuto non solutivo e revisione didattica. |
| Provenienza verificata | **Sì** | Solo metadati strutturati (`sourceRefs`, commit, percorso). Non usare come testo i percorsi che puntano a soluzioni. |
| Descrizioni ufficiali | **Sì** | Se disponibili. Oggi sono 0: le fonti non contengono il testo ufficiale delle challenge. |
| Descrizioni derivate | **Condizionale** | Sempre etichettate come derivate, mai come ufficiali; escludere passaggi risolutivi; richiedere revisione umana. |
| Writeup ufficiali | **Non automaticamente** | Licenza e sicurezza: GPL-3.0 dichiarata. Utilizzabili solo come materiale post-soluzione esplicito e con controllo del contenuto, non nel contesto tutor di default. |
| Soluzioni community | **No, per ora** | Licenza non verificata: nessuna autorizzazione di pubblicazione o indicizzazione. |
| Allegati | **No** | Binari, immagini, ZIP e file non leggibili non sono interpretati; licenza dei singoli asset non dichiarata. |
| Flag | **No** | Archivio ristretto locale; mai in KB, RAG, API o frontend. |
| Contenuto derivato/non verificato | **No, per ora** | `derived-context` e concetti estratti da soluzioni restano fuori dal tutor finché non sono revisionati e rietichettati. |

In sintesi, con lo stato attuale il tutor può utilizzare con sicurezza solo:

- il catalogo demo `unverified-demo`, esplicitamente dichiarato tale;
- metadati strutturati di provenienza, senza percorsi solutivi nel testo;
- concetti generali di cybersecurity, se riscritti come materiale didattico autorizzato;
- descrizioni ufficiali, quando e se arriverà un export autorizzato.

Non possono essere usati ora: writeup completi, script community, flag, allegati, archivi non estratti, testi derivati con indizi operativi.

---

## 7. Contenuti da escludere

1. `solutionArchive` in qualsiasi forma: testo, chunk, indice, cache, bundle o risposta API.
2. `derived-context` non revisionato, in particolare i 13 chunk con indizi operativi elencati nel finding **A1**.
3. Righe `Fonte:` che elencano percorsi di writeup/soluzioni dentro il testo dei chunk.
4. Contenuti con licenza non verificata: tutti i file della repository community.
5. Flag reali e formati flag-like non esplicitamente autorizzati e labelizzati.
6. Allegati binari, immagini, ZIP e file non leggibili come UTF-8.
7. Descrizioni derivate presentate come `description` ufficiale senza etichetta visibile.
8. Qualsiasi contenuto che il modello potrebbe interpretare come sequenza di comandi da copiare o step-by-step completo.

---

## 8. Modifiche consigliate per una futura implementazione RAG

Le azioni 1–8 sono state applicate nella Fase 2. I punti 9–12 restano procedure future: il retrieval server-side richiede una decisione separata e il Solution Archive resta un archivio locale, non una risorsa distribuita.

1. **Schema di classificazione**: aggiungere `classification`, `tutorAllowed`, `reviewStatus`, `publicExposure`, `restricted` a ogni documento e chunk. Usare questi campi come filtro obbligatorio nel retrieval.
2. **Gate di licenza**: indicizzare solo documenti con `licenseVerified === true` e `tutorAllowed === true`. Mantenere i contenuti community in locale, senza upload su Cloudflare.
3. **Separazione metadati/testo**: rimuovere la riga `Fonte:` dal testo dei chunk; usare `sourceRefs` strutturati per citazioni e UI.
4. **Default sicuro per `derived-context`**: escluderlo dal RAG. Introdurre semmai una classe `reviewed-hint` creata a mano, con testo non operativo e revisione esplicita.
5. **Redaction corretta**: pulire il Markdown prima di redigere; restringere il pattern dei token per non includere percorsi; validare che `[FLAG_RIMOSSA]`, `[SEGRETO_RIMOSSO]` e `[TOKEN_RIMOSSO]` non siano deformati.
6. **Rilevamento learning-material**: usare il percorso relativo alla repository per classificare `Introduzione/...`; verificare che il contenuto sia didattico e autorizzato prima di indicizzarlo.
7. **Etichetta esplicita delle descrizioni derivate**: non copiarle in `description`/`statement` senza prefisso "non ufficiale"; separare il campo semantico da quello derivato.
8. **Validazione più ampia**: bloccare `flag{`, `OliDuck{`, `ITA{`, `ITASEC{`, `CTF{`, forme con parentesi quadre e placeholder deformati, con allowlist documentata.
9. **Retrieval server-side**: nessun endpoint che restituisca chunk grezzi; il client riceve solo risposte del tutor e citazioni autorizzate. Mantenere boundary casuale e system prompt statico già presenti.
10. **Test aggiuntivi automatici**: classificazione ammessa, assenza di docType solutivi, riferimenti risolvibili, gate licenza, assenza di flag/formati flag-like, assenza di percorsi sorgente nel testo, non modificabilità del catalogo demo.
11. **Archivio ristretto reale**: se il repository è pubblico, spostare il Solution Archive fuori dal repository o in area con accesso controllato; in ogni caso mai dentro `public/` o in binding Cloudflare.
12. **Nomenclatura temporale**: rinominare `generatedAt` in `sourceSnapshotAt` per evitare che sia interpretato come data di esecuzione.

---

## 9. Verifiche eseguite in questa audit

- Conteggi e tipologie ricalcolati da `catalog.json`, `rag-index.json`, `manifest.json`, `import-report.json` e `derived/application-catalog.json`.
- Scansione semantica dei 228 chunk `derived-context`, con identificazione di 13 chunk contenenti indizi operativi.
- Verifica dei riferimenti: 0 percorsi mancanti in catalogo e RAG rispetto al manifest.
- Verifica delle flag per sezione: assenti in catalogo applicativo, KB e RAG; presenti solo nel Solution Archive locale.
- Verifica del runtime: nessun riferimento a RAG/solution archive/dataset in `functions/`, `public/src/` o `wrangler.toml`; binding AI commentato.
- Verifica del catalogo demo: `unverified-demo`, 7 record, tutti `demo: true`, non sovrascritto.
- Aggiunti test read-only in `tests/security-audit.test.mjs` per separazione, provenienza, licenze e assenza di esposizione.

Archivi ZIP non estratti, script/allegati delle fonti non eseguiti, Workers AI non attivato, frontend non modificato, `public/data/` non modificato.

---

## 10. Stato dopo la bonifica (Fase 2)

### 10.1 Correzioni applicate

| Finding | Correzione effettiva |
| --- | --- |
| A1 | I documenti `derived-context`, `concept-index` e `challenge-overview` restano nel solo inventario `publicationGate.excludedDocuments`; non entrano più in `learningKnowledgeBase` né in `rag-index.json`. I 228 chunk derivati da writeup/soluzioni sono stati tutti esclusi. |
| A2 | Le righe `Fonte:` non sono più serializzate nel testo dei candidati KB. I percorsi restano solo nei campi strutturati (`sourceRefs`, `sourceId`, `sourcePath`, `sourceRepository`, `sourceCommit`, `license`, `provenanceType`, `documentType`). |
| A3 | Il gate richiede `license.verified === true`, `publicationAllowed === true` e `reviewStatus === 'approved'`. Tutti i documenti con licenza non verificata sono esclusi. |
| A4 | La redaction protegge i percorsi sorgente prima di cercare token Base64; un percorso `community-solutions/...` non viene più trasformato in `[TOKEN_RIMOSSO]`. |
| A5 | I placeholder sono protetti durante la pulizia Markdown e i placeholder deformati vengono ripristinati ai valori esatti. |
| A6 | `roleOf()` usa il percorso relativo alla repository: `community-solutions/Introduzione/...` è ora classificato `learning-material`. La licenza resta non verificata, quindi quei file non sono autorizzati per il tutor. |
| A7 | `generatedAt` resta lo snapshot deterministico delle fonti; il report dichiara esplicitamente che non è una data di build. |
| A8 | Ogni documento e chunk ha `classification`, `documentType`, `provenanceType`, `publicationAllowed`, `reviewStatus` e `publicationGate`. Le classificazioni ammesse sono solo `official-description` e `learning-material`. |
| A9 | `import-dataset.mjs` non copia più `description.derived.text` in `description`/`statement`; i tag derivati non sono copiati. |
| A10 | La validazione dell'importatore usa gli stessi pattern del gate e blocca flag con parentesi graffe/quadre/tonde, prefissi `flag`, `ITA`, `ITASEC`, `CTF`, `OliDuck`, forme con underscore e placeholder deformati. |
| A11 | Il Solution Archive resta local-only con 348 documenti, `exposePublicly: false`, `cloudflareUploadAllowed: false` e `tutorAllowed: false`. Nessun upload o pubblicazione è stato effettuato. |
| A12 | Gli ID restano invariati; non è stata inventata alcuna identità semantica alternativa. |

### 10.2 Conteggi correnti

| Metrica | Valore |
| --- | ---: |
| Challenge catalog | 408 |
| Candidati KB valutati dal gate | 1050 |
| Documenti KB ammessi | **0** |
| Documenti KB esclusi | 1050 |
| Chunk RAG autorizzati | **0** |
| Documenti Solution Archive | 348 |
| File inventariati | 444 |
| Documenti `learning-material` riconosciuti | 57 |

Il corpus RAG autorizzato è **vuoto**: non esistono descrizioni ufficiali nelle fonti e il materiale didattico riclassificato nella repository community non ha licenza verificata. Non è stato inventato alcun contenuto sostitutivo.

### 10.3 Limiti residui

- Il RAG **non è pronto**: non ci sono documenti autorizzati da indicizzare.
- Il retrieval server-side, Vectorize e Workers AI non sono implementati né attivati; `rag-index.json` non è caricato dal runtime.
- Le descrizioni derivate restano nel solo dataset locale di ricerca, con provenienza esplicita, ma non nel catalogo applicativo.
- La completezza del catalogo ufficiale resta non verificabile senza un export autorizzato.
- Il Solution Archive contiene flag reali: le restrizioni nei metadati non sostituiscono un controllo di accesso filesystem/deploy.
- La licenza dei singoli allegati resta non dichiarata separatamente; non ne viene assunto il riutilizzo.
- `generatedAt` continua a indicare lo snapshot delle fonti, non l'istante della build.

### 10.4 Verifiche dopo la bonifica

- `npm test`: eseguito, con 10 test dedicati alla bonifica più i test preesistenti.
- `npm run dataset:build` e `npm run dataset:import`: eseguiti senza `--apply`.
- Generazione deterministica: due esecuzioni producono hash identici per tutti gli artifact.
- Nessun chunk derivato da writeup/soluzione, nessuna flag, nessun percorso sorgente e nessun placeholder deformato nel corpus tutor.
- `public/data/challenges.json` e `public/data/import-report.json` invariati.
- `git diff --check`: eseguito a fine intervento.

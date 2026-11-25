# OliDuck — Report di bonifica KB/RAG (Fase 2)

Branch: `feature/oliduck-app`. Stato: correzioni applicate alla pipeline e agli artifact del dataset; **nessuna integrazione runtime**.

Il punto di partenza è `c43e3ab` (`docs: aggiunge audit sicurezza KB RAG e test separazione`), con working tree pulito e `HEAD == origin/feature/oliduck-app`. Le fonti pubbliche, l'inventario e il Solution Archive locale sono stati conservati. Nessun programma, script, binario o allegato proveniente dalle repository delle fonti è stato eseguito; l'archivio ZIP non è stato estratto. Non sono stati effettuati upload su Cloudflare, non è stato attivato Workers AI e la configurazione di produzione non è stata modificata.

## 1. Correzioni applicate

| Area | Correzione |
| --- | --- |
| Classificazione | Aggiunti `classification`, `documentType`, `provenanceType`, `publicationAllowed`, `reviewStatus` e `publicationGate` a documenti, chunk e record del catalogo. Classificazioni ammesse: `official-description`, `learning-material`. |
| `roleOf()` | Il prefisso della repository viene rimosso prima di riconoscere `Introduzione/`. I file `community-solutions/Introduzione/...` sono ora classificati `learning-material`, senza autorizzarne la pubblicazione. |
| Licenze | La licenza viene rilevata dal contenuto di un file `LICENSE`/`COPYING` presente nella repository. Se non è riconosciuta, resta `non verificata`. La provenienza non implica autorizzazione. |
| Contenuti derivati | `derived-context`, `concept-index` e `challenge-overview` non entrano più nella KB utilizzabile dal tutor. Restano tracciati come esclusi. |
| Community | Nessun documento community senza licenza verificata può entrare nel corpus. I materiali didattici community restano classificati ma non autorizzati. |
| Separazione provenienza/testo | Le righe `Fonte:` non sono più serializzate nel testo. I percorsi restano solo nei campi strutturati `sourceId`, `sourcePath`, `sourceRepository`, `sourceCommit`, `license`, `provenanceType`, `documentType` e `sourceRefs`. |
| Redaction | Placeholder protetti durante la pulizia Markdown e placeholder deformati ripristinati ai valori esatti. La redaction copre flag con graffe, parentesi quadre/tonde, maiuscole, minuscole, underscore e prefissi `flag`, `ITA`, `ITASEC`, `CTF`, `OliDuck`. I percorsi sorgente sono protetti prima della ricerca di token Base64. |
| Gate | `scripts/lib/publication-gate.mjs` implementa `DENY` come default e verifica autorizzazione esplicita, revisione, licenza, provenienza, riferimenti, classificazione e assenza di flag/soluzioni/percorsi nel testo. |
| RAG futuro | `rag-index.json` espone filtri per `challengeId`, `category`, `edition`, `classification`, campi di citazione strutturati e `runtimeConnected: false`. Non sono stati implementati Vectorize, Workers AI o retrieval server-side. |
| Catalogo applicativo | `scripts/import-dataset.mjs` non copia più descrizioni derivate in `description`/`statement`, non copia i tag derivati e non espone percorsi sorgente. La validazione usa gli stessi pattern del gate. |
| Solution Archive | Conservazione integrale: 348 documenti, tutti `restricted: true`, `tutorAllowed: false`, `exposePublicly: false`, `cloudflareUploadAllowed: false`. |

## 2. Problemi rimasti

- **Il corpus RAG autorizzato è vuoto**: 0 documenti e 0 chunk. Non ci sono descrizioni ufficiali nelle fonti e il materiale didattico community non ha licenza verificata. Il RAG **non è pronto** per l'integrazione del tutor.
- Il catalogo ufficiale completo resta non verificabile senza un export autorizzato.
- Le descrizioni derivate restano nel dataset locale di ricerca, con provenienza esplicita; non sono contenuto autorizzato per il tutor.
- Il Solution Archive contiene flag reali: le restrizioni dichiarate non sostituiscono un controllo di accesso su filesystem o deploy.
- La licenza dei singoli allegati non è dichiarata separatamente.
- `generatedAt` indica lo snapshot delle fonti, non l'istante della build.
- Il retrieval dovrà essere aggiunto esplicitamente in futuro, solo dopo che esisteranno documenti approvati e dopo una revisione separata del contesto tutor.

## 3. Test eseguiti

| Comando | Esito |
| --- | --- |
| `npm run dataset:build` | OK — 408 challenge, 0 documenti KB ammessi, 0 chunk, 348 documenti Solution Archive |
| `npm run dataset:import` | OK — 408 challenge, 0 soluzioni importate, `public/data/` non toccato |
| `node --test tests/remediation.test.mjs` | 10/10 test passati |
| `npm test` | 57/57 test passati |
| Generazione deterministica | OK — hash identici su due esecuzioni degli artifact |
| `git diff --check` | da completare nella verifica finale |

Le 10 verifiche dedicate sono: esclusione derivati da writeup/soluzione, esclusione community non licenziati, assenza flag, placeholder preservati, percorsi sorgente fuori dal testo, riferimenti strutturati, gate DENY, separazione Solution Archive, catalogo demo invariato, determinismo.

## 4. File modificati

- `scripts/build-dataset.mjs` — classificazione, licenze da file, gate, KB/RAG autorizzati, report generati.
- `scripts/import-dataset.mjs` — nessuna descrizione/tag derivato, validazione ampliata.
- `scripts/lib/text-normalization.mjs` — nuovo modulo di redaction e pulizia.
- `scripts/lib/publication-gate.mjs` — nuovo modulo del gate con default `DENY`.
- `tests/dataset.test.mjs`, `tests/security-audit.test.mjs` — adattati al nuovo schema e ai nuovi conteggi.
- `tests/remediation.test.mjs` — nuovo file con 10 verifiche dedicate.
- `dataset-input/catalog.json`, `dataset-input/rag-index.json`, `dataset-input/manifest.json`, `dataset-input/import-report.json`, `dataset-input/REPORT.md` — artifact rigenerati.
- `dataset-input/derived/application-catalog.json`, `dataset-input/derived/application-import-report.json` — catalogo applicativo derivato rigenerato senza `--apply`.
- `dataset-input/SECURITY-AUDIT.md`, `docs/DATASET.md` — documentazione aggiornata.
- `dataset-input/REMEDIATION-REPORT.md` — questo report.

Non modificati: `public/data/challenges.json`, `public/data/import-report.json`, `wrangler.toml`, `functions/`, `public/src/`, le directory `dataset-input/sources/`.

## 5. Commit e push

Le modifiche sono state completate e committate esclusivamente su `feature/oliduck-app`, poi pushed sul corrispondente branch remoto. Non è stato effettuato alcun force push e `main` non è stata toccata. L'hash del commit è disponibile nella cronologia Git locale e remota.

## 6. Documenti ammessi nel futuro corpus RAG

**0 documenti, 0 chunk.** Il gate ha valutato 1050 candidati e ne ha esclusi 1050. Non dichiarare il RAG pronto finché non esisteranno documenti autorizzati, revisionati e verificabili.

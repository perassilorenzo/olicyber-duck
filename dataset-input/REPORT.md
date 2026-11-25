# REPORT — acquisizione fonti pubbliche OliDuck

Generato in modo deterministico dall'ultimo commit delle fonti: `2026-03-25T15:27:23+01:00`.

## 1. Sintesi

| Metrica | Valore |
| --- | ---: |
| Repository analizzate | 2 |
| File esaminati (inclusi metadati Git) | 444 |
| File di contenuto | 386 |
| File metadati repository (`.git/`) | 58 |
| Challenge identificate | 465 |
| Righe dell'indice ufficiale | 155 |
| ID sorgente ufficiali unici | 154 |
| Challenge ufficiali dal README | 155 |
| Challenge solo community | 310 |
| Candidati community agganciati a challenge ufficiali | 13 |
| Descrizioni ufficiali | 0 |
| Descrizioni derivate da writeup/soluzioni | 228 |
| Writeup ufficiali | 154 |
| File soluzione community | 179 |
| Documenti nel Solution Archive | 348 |
| Allegati | 37 |
| Categorie | 5 |
| Edizioni | 20 |
| Gruppi di duplicati esatti | 22 |
| Copie duplicate esatte | 24 |
| ID challenge sorgente duplicati | 2 |
| File non leggibili | 42 |
| Archivi non estratti | 1 |
| Documenti Learning Knowledge Base | 1125 |
| Chunk RAG | 1125 |

**Categorie:** binary, crypto, misc, network, web.

**Edizioni:** 2021, 2021 - nazionale, 2022, 2022 - territoriale, 2023, 2023 - Training Camp, 2024 - nazionale, OliCyber.IT 2021 - Competizione nazionale, OliCyber.IT 2022 - Competizione nazionale, OliCyber.IT 2022 - Selezione territoriale, OliCyber.IT 2023 - Competizione nazionale, OliCyber.IT 2023 - Selezione territoriale, OliCyber.IT 2023 - Training Camp 1, OliCyber.IT 2023 - Training Camp 2, OliCyber.IT 2023 - Training Camp 3, OliCyber.IT 2024 - Competizione nazionale, OliCyber.IT 2024 - Competizione territoriale, OliCyber.IT 2025 - Competizione nazionale, OliCyber.IT 2025 - Competizione territoriale, OliCyber.IT 2026 - Competizione territoriale.

## 2. Fonti

- `official-writeups` — https://github.com/OliCyberIT/OliCyber.IT-Writeups — commit `0d1ac26e3cc01c0ba85ab25d04cf1ece4548fa63` — licenza: **GPL-3.0** — file: 210
- `community-solutions` — https://github.com/Privitorta/Training-OliCyber.IT-solutions — commit `081b0fef425b91e6ee34352643cbb9e5a1aac50d` — licenza: **non verificata** — file: 234

Nessuna richiesta di rete è stata effettuata durante l'analisi. Nessun programma, script, binario o allegato delle fonti è stato eseguito. L'unico archivio ZIP presente è stato inventariato e **non estratto**.

## 3. Separazione dei dati

- **Challenge Catalog** (`catalog.json`, chiave `challengeCatalog`): metadati, provenienza e descrizioni *derivate*. Nessun testo di soluzione.
- **Learning Knowledge Base** (`catalog.json`, chiave `learningKnowledgeBase`; indice in `rag-index.json`): concetti, contesto didattico e materiali, senza flag e senza passaggi risolutivi.
- **Solution Archive** (`catalog.json`, chiave `solutionArchive`): writeup ufficiali, script e soluzioni community. `exposePublicly: false`, `cloudflareUploadAllowed: false`, non indicizzato per il tutor.

## 4. Descrizioni e provenienza

**Descrizioni ufficiali: 0.** Le fonti disponibili non contengono il testo ufficiale delle challenge: contengono indici, writeup e soluzioni. Ogni challenge dichiara quindi `description.official: null`.

**Descrizioni derivate: 228** sono contrassegnate con percorso del file e metodo di estrazione. Non sono mai presentate come descrizioni ufficiali.

## 5. Duplicati e conflitti

### ID sorgente duplicati

| ID record | ID sorgente | Titolo |
| --- | --- | --- |
| oc-2025-nazionale-726-r5 | 726 | Party Mode |
| oc-2025-nazionale-726-r7 | 726 | Live and Let Die |

L'ID `726` compare due volte nel README ufficiale per due titoli diversi. I record sono stati mantenuti separati con ID stabili suffissati dal numero di riga; non è stata fatta alcuna scelta arbitraria.

### Duplicati esatti

Sono stati rilevati 22 gruppi di file con contenuto identico (24 copie aggiuntive). L'elenco completo è in `manifest.json`, chiave `duplicateGroups`.

### Writeup condivisi e agganci community

Alcuni writeup ufficiali coprono più challenge (per esempio `2022-nazionale/binary2-3.md`): il file è referenziato da più record senza unire le challenge. I candidati community sono stati agganciati solo in presenza di ID esplicito nel testo o di titolo normalizzato identico nella stessa edizione; i casi ambigui restano separati e segnalati in `import-report.json`.

## 6. Leggibilità e archivi

- File non leggibili come testo UTF-8: **42** (di cui **34** tra i file di contenuto). Sono immagini, binari, metadati Git o file con byte non testuali; vengono inventariati per hash e dimensione, senza interpretazione del contenuto.
- Archivi: **1** (`output`, ZIP). Non estratti: contenuto e sicurezza non verificati.

## 7. Licenze e avvisi

- `official-writeups` dichiara **GPL-3.0** nel file `LICENSE`: il riutilizzo del dataset derivato deve conservare la medesima attribuzione/condizione.
- `community-solutions` **non dichiara alcuna licenza**. La licenza di ogni file è registrata come `non verificata`: non è lecito presumere un permesso di pubblicazione.
- Nessun file community, writeup completo, flag o soluzione è stato caricato su Cloudflare o incluso in `public/`.
- Il Solution Archive contiene flag reali presenti nelle fonti: resta un archivio locale ristretto.
- La licenza dei singoli allegati (immagini/binari) non è dichiarata separatamente: non ne è stato assunto il riutilizzo.

## 8. Informazioni mancanti

Conteggio per campo, calcolato sui record del Challenge Catalog:

| Campo mancante | Record |
| --- | ---: |
| descrizione ufficiale (assente nelle fonti) | 465 |
| autore della challenge | 310 |
| edizione | 284 |
| categoria | 219 |

Il numero totale ufficiale delle challenge Training non è pubblico: questo dataset **non dimostra completezza**.

## 9. Verifica finale

| Controllo | Esito |
| --- | --- |
| Ogni challenge ha almeno un riferimento a un file esistente | OK |
| Ogni chunk RAG ha riferimenti alla fonte | OK |
| Nessuna flag nel catalogo o nella knowledge base | OK |
| Soluzioni non esposte pubblicamente | OK |

## 10. Aggiornamenti ripetibili

Rieseguendo `npm run dataset:build` con una nuova versione delle fonti:

- gli ID sono derivati da percorso/ID sorgente e restano stabili;
- i file sono identificati per SHA-256, quindi i duplicati non vengono accumulati;
- gli output vengono riscritti integralmente in modo deterministico;
- `npm run dataset:import` produce un catalogo applicativo sanificato in `dataset-input/derived/` senza toccare `public/data/`;
- solo `npm run dataset:import -- --apply` sovrascrive esplicitamente il catalogo applicativo, con stato `unverified-derived`.

Lo stato dell'applicazione resta `unverified-demo` finché non viene fornito un export ufficiale autorizzato.


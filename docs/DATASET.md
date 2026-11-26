# Dataset di ricerca OliDuck

Questo documento descrive il dataset costruito dalle fonti pubbliche scaricate in
`dataset-input/sources/` e generato in `dataset-input/`.

## Fonti

| Directory | Repository | Licenza | Uso consentito |
| --- | --- | --- | --- |
| `official-writeups/` | `OliCyberIT/OliCyber.IT-Writeups` | GPL-3.0 (rilevata dal contenuto di `LICENSE`) | metadati autorevoli e writeup; conservare la licenza in caso di redistribuzione |
| `community-solutions/` | `Privitorta/Training-OliCyber.IT-solutions` | **nessuna licenza dichiarata** | analisi locale; **nessuna pubblicazione o upload su Cloudflare senza autorizzazione** |

La licenza non viene mai dedotta dal nome della repository: viene rilevata solo se un file `LICENSE`/`COPYING` è presente e il suo contenuto è riconosciuto. In caso contrario il valore resta `non verificata`.

Le fonti sono state lette dal filesystem locale. Non sono state effettuate richieste di rete, non è stato eseguito alcun file proveniente dalle fonti e l'unico archivio ZIP presente non è stato estratto.

## Comandi

```bash
npm run dataset:build
npm run dataset:import
```

- `dataset:build` rigenera `REPORT.md`, `manifest.json`, `import-report.json`, `catalog.json` e `rag-index.json`.
- `dataset:import` crea `dataset-input/derived/application-catalog.json` e il relativo report, **senza toccare `public/data/`**.
- Per sostituire esplicitamente il catalogo applicativo:

```bash
npm run dataset:import -- --apply
```

L'overwrite produce uno catalogo con `status: "unverified-derived"`: non equivale a un export ufficiale verificato.

Questo dataset di fonti pubbliche è distinto dall'import browser che alimenta l'app: `npm run dataset:browser-import` genera il catalogo reale in `public/data/olicyber-challenges.json` e l'indice RAG runtime in `functions/data/rag-index.json`. Il `rag-index.json` descritto sotto, generato da `dataset:build`, contiene invece solo chunk della KB autorizzata (oggi vuota) e **non** viene usato dal tutor. Vedi [`CATALOG-IMPORT.md`](CATALOG-IMPORT.md).

## Struttura del dataset

`dataset-input/catalog.json` contiene tre sezioni distinte:

| Sezione | Contenuto | Esposizione |
| --- | --- | --- |
| `challengeCatalog` | ID, titolo, categoria, edizione, autore, provenienza, descrizione derivata, allegati citati | non autorizzato per il tutor; importabile solo dopo sanificazione |
| `learningKnowledgeBase` | solo documenti ammessi dal gate di pubblicazione | oggi vuota (0 documenti); nessun chunk derivato da writeup/soluzioni |
| `solutionArchive` | writeup ufficiali, script, soluzioni community e materiale didattico non verificato | `exposePublicly: false`, `tutorAllowed: false`, non indicizzata, non importata |

`rag-index.json` contiene solo chunk della Learning Knowledge Base autorizzata. Ogni chunk conserva `challengeId`, `title`, `category`, `edition`, `classification`, `docType`, `sourceId`, `sourcePath`, `sourceRepository`, `sourceCommit`, `license`, `provenanceType`, `documentType` e `sourceRefs`. Sono definiti filtri per `challengeId`, `category`, `edition` e `classification`, e i campi di citazione sono esplicitati in `citationFields`. Il tutor non deve ricevere interi repository o writeup.

### Gate di pubblicazione

Il gate ha default `DENY`. Un documento entra nel corpus solo con:

- `publicationAllowed === true` e `reviewStatus === 'approved'`;
- licenza verificata e classificazione ammessa (`official-description` o `learning-material`);
- provenienza e riferimenti alla fonte risolvibili;
- testo senza flag, soluzioni, righe `Fonte:` o percorsi sorgente.

I documenti respinti restano tracciati in `catalog.json` → `publicationGate.excludedDocuments`, con classificazione e motivi di esclusione. Il testo del tutor non contiene percorsi sorgente: la provenienza è sempre strutturata.

## Schema degli ID

- Challenge ufficiale: `oc-<edizioneSlug>-<challengeId>`, con suffisso `-r<numeroRiga>` solo quando l'ID sorgente è duplicato (caso noto: `726`).
- Challenge community non agganciata: `cs-<evento>-<titolo-derivato-da-percorso>`.

Gli ID non vengono mai assegnati in base a similarità di titolo. Un candidato community viene agganciato a una challenge ufficiale solo in presenza di:

1. ID esplicito (`#challenge-<n>` o URL equivalente) nel testo della soluzione; oppure
2. titolo normalizzato identico nella stessa edizione.

Se le evidenze sono contrastanti o il titolo è ambiguo, il candidato resta una challenge separata e il conflitto viene segnalato.

## Descrizioni

Le fonti disponibili **non contengono descrizioni ufficiali**. Ogni record ha `description.official: null`.

Il campo `description.derived` contiene, quando presente, il primo paragrafo utile estratto da una writeup o da un blocco citato di una soluzione community. La provenienza è sempre registrata con percorso e metodo. Questo testo non è mai etichettato come descrizione ufficiale, non entra nel corpus RAG e non viene copiato in `description`/`statement` o nei tag dal catalogo applicativo derivato.

## Aggiornamenti ripetibili

Il builder è deterministico e sovrascrive gli output. Per aggiornare le fonti:

1. sostituire o aggiornare le directory in `dataset-input/sources/`;
2. eseguire `npm run dataset:build`;
3. eseguire `npm run dataset:import`;
4. verificare `dataset-input/REPORT.md` e `dataset-input/import-report.json`.

Gli ID derivano da percorsi e ID sorgente; i file sono identificati per SHA-256. Una nuova versione delle fonti aggiorna i record esistenti senza accumulare duplicati. Le cartelle `dataset-input/sources/` sono ignorate da Git: i materiali scaricati restano locali.

## Limiti

- Il numero totale ufficiale delle challenge Training non è pubblico: la completezza non è verificabile.
- Il catalogo applicativo demo resta `unverified-demo` finché non arriva un export autorizzato.
- Il corpus RAG autorizzato è vuoto (0 documenti, 0 chunk): non è pronto per collegare il tutor. Non sono stati inventati contenuti sostitutivi.
- I flag presenti nelle writeup restano confinati nel Solution Archive locale: non sono presenti nella KB autorizzata, nell'indice RAG o nel catalogo applicativo generato.
- Il Solution Archive contiene flag reali: i flag `restricted`, `exposePublicly: false` e `cloudflareUploadAllowed: false` non sostituiscono un controllo di accesso.
- Le licenze dei singoli allegati non sono dichiarate separatamente: non ne viene assunto il riutilizzo.
- `generatedAt` indica lo snapshot deterministico delle fonti, non la data di esecuzione del builder.

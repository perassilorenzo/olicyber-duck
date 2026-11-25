# Importazione autorizzata del catalogo

## Principi

1. Il catalogo delle challenge OliCyber Training è accessibile solo con autenticazione. Le API anonime `/api/challenges`, `/api/challenges/<id>` e `/api/admin/challenges/export` rispondono `LOGIN_REQUIRED`.
2. OliDuck **non tenta alcun bypass** di login, token, cookie o sessioni.
3. L'unica via supported è un **export ottenuto legalmente dall'utente** con il proprio account o un'autorizzazione scritta dei mantenitori.
4. Le challenge DEMO attuali non sono ufficiali e restano contrassegnate come tali finché non viene importato un export verificato.
5. Writeup, flag e soluzioni **non entrano** nella libreria né nel contesto dell'assistente.

La ricerca sulle fonti pubbliche e i limiti dell'analisi sono documentati in [`PUBLIC-SOURCES-RESEARCH.md`](PUBLIC-SOURCES-RESEARCH.md).

## Formato accettato

`scripts/import-catalog.mjs` accetta:

- un array di record;
- un oggetto con `challenges[]` o `data.challenges[]`;
- un oggetto con `challenges` suddivise per categoria.

Campi riconosciuti (opzionali, se non presenti restano `null`):

| Campo export | Destinazione |
| --- | --- |
| `id`, `challenge_id` | `originalId` e `id` (`olicyber-<id>`) |
| `name`, `title` | `title` |
| `description`, `statement` | `description` / `statement` |
| `value` | `score` |
| `state` | `state`, `available` |
| `tags[]` | `tags[]` |
| `files[{name,url}]` | `attachments[]` |
| `author`, `edition`/`event`, `path`, `published_at`/`date`/`created` | campi corrispondenti |

I campi `flag`, `flags`, `solution`, `writeup`, `writeups` vengono ignorati e segnalati in `metadata.ignoredSensitiveFields`. Se il JSON risultante contiene un pattern di flag, l'import si interrompe.

## Uso

```bash
node scripts/import-catalog.mjs \
  --file /percorso/export-autorizzato.json \
  --expected-total 123 \
  --source-name "Export admin OliCyber 2026" \
  --portal "https://training.olicyber.it"
```

Opzioni:

- `--file` (obbligatorio): percorso del file JSON autorizzato;
- `--out` (default `public/data/challenges.json`);
- `--report` (default `public/data/import-report.json`);
- `--expected-total`: numero totale ufficiale fornito dall'export;
- `--source-name`: etichetta di provenienza;
- `--portal`: base per ricostruire l'URL originale quando manca.

L'importatore:

- non effettua richieste di rete;
- non legge token, cookie, sessioni o variabili d'ambiente;
- deduplica per `originalId` (poi per titolo) e conta i duplicati;
- converte tag HTML essenziali nel testo;
- genera il report con conteggi, categorie, limiti e `verifiedAgainstSource`.

## Stati del catalogo

| Condizione | `status` | `verifiedAgainstSource` |
| --- | --- | --- |
| Catalogo demo iniziale | `unverified-demo` | `false` |
| Export importato senza `--expected-total` | `imported-unverified` | `false` |
| Export importato con `imported === expectedTotal` | `verified-import` | `true` |
| Export importato con conteggio diverso | `imported-unverified` | `false` |
| Dataset derivato da fonti pubbliche | `unverified-derived` | `false` |

Anche con `verified-import`, dichiarare la completezza solo se il totale ufficiale è stato fornito da una fonte autorizzata.

## Import del dataset di ricerca

`scripts/import-dataset.mjs` converte solo la sezione `challengeCatalog` del dataset in un catalogo applicativo v2. Non importa la knowledge base completa e **non importa mai il Solution Archive**.

```bash
npm run dataset:build
npm run dataset:import
```

Di default l'output è `dataset-input/derived/application-catalog.json`: `public/data/` resta invariato. Per sovrascrivere esplicitamente il catalogo applicativo:

```bash
npm run dataset:import -- --apply
```

Anche con `--apply` lo stato resta `unverified-derived`. Vedi [`DATASET.md`](DATASET.md) per schema, ID stabili, regole di aggancio e avvisi sulle licenze.

## Provenienza per record

Ogni challenge conserva:

```json
"provenance": {
  "source": "Export admin OliCyber 2026",
  "sourceUrl": "https://training.olicyber.it/challenges/<id>",
  "importedAt": "2026-...",
  "verified": true
}
```

L'export autorizzato prevale sempre sull'indice pubblico dei writeup. In caso di conflitto (ad esempio l'ID `726` duplicato nel README ufficiale) non inventare dati: segnalare il conflitto nel report e chiedere conferma ufficiale.

## Separazione dei dati

L'aggiornamento di `public/data/challenges.json` non tocca la chiave `oliduck:state` nel browser. Stati personali, conversazioni e preferenze sopravvivono a re-import e ridistribuzioni. Prima di un import, è comunque buona pratica esportare o annotare il numero totale ufficiale e la data dell'export.

## Verifica dopo l'import

```bash
npm test
npm run dev -- --port 8788
curl -s http://localhost:8788/api/status
node -e "const c=require('./public/data/challenges.json'); console.log(c.status, c.completeness.imported, c.completeness.verifiedAgainstSource)"
```

La UI deve mostrare il badge DEMO solo per record con `demo: true` e i link esterni solo quando `sourceUrl` è presente e verificato.

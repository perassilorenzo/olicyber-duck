# Ricerca sulle fonti pubbliche delle challenge OliCyber

- **Data analisi:** 2026-11-25
- **Obiettivo:** determinare quali dati delle challenge sono recuperabili da fonti pubbliche e autorizzate, e quali richiedono un'esportazione ufficiale.
- **Metodo:** GitHub REST API pubblica, `raw.githubusercontent.com`, richieste HTTP anonime a `https://training.olicyber.it`.
- **Vincoli rispettati:** nessun login, token, cookie, sessione o credenziale; nessun uso di scraper che richiedano autenticazione; nessuna modifica al catalogo definitivo (`public/data/challenges.json`); nessun writeup, flag o soluzione importata nella libreria.

---

## 1. Sintesi

| Risultato | Dettaglio |
| --- | --- |
| Unica fonte **ufficiale pubblica** di dati strutturati sulle challenge | [`OliCyberIT/OliCyber.IT-Writeups`](https://github.com/OliCyberIT/OliCyber.IT-Writeups) (GPL-3.0) |
| Voci censite | **155** righe di tabella, **154 ID Training unici** |
| Copertura temporale | 2021–2026, nazionale / territoriale / Training Camp |
| Corrispondenza con il portale | **dichiarata** dal repo ufficiale tramite URL `training.olicyber.it/challenges#challenge-<id>`, **non verificabile** via API senza autenticazione |
| Dati mancanti | testo ufficiale della challenge, descrizione ufficiale, punteggio, difficoltà, allegati scaricabili, stato di disponibilità, conteggio totale del catalogo |
| API del portale | `/api/challenges` → `500 LOGIN_REQUIRED`; `/api/challenges/<id>` → `500 LOGIN_REQUIRED`; `/api/admin/challenges/export` → `500 LOGIN_REQUIRED` |
| Conclusione | Le fonti pubbliche **non bastano** a ricostruire il catalogo. Servono un'export autorizzata o una verifica ufficiale dei dati. |

---

## 2. Fonti individuate

### 2.1 Fonti ufficiali

| Fonte | URL | Natura | Challenge identificabili | Licenza |
| --- | --- | --- | --- | --- |
| OliCyber.IT Writeups | https://github.com/OliCyberIT/OliCyber.IT-Writeups | Writeup **ufficiali** delle challenge OliCyber | 155 voci, 154 ID unici | GPL-3.0 |
| CyberChallenge.IT AD 2024 | https://github.com/CyberChallengeIT/CyberChallenge.IT-AD-2024 | Servizi Attack/Defense della gara nazionale 2024 | Non è un catalogo di challenge jeopardy | GPL-3.0 |
| CINI Cybersecurity National Lab (org) | https://github.com/CybersecNatLab | 4 repository per gare ICC/AD (2022, 2023) | Non è un catalogo Training | GPL-3.0 |

Il repository ufficiale dei writeup è l'unico dell'organizzazione `OliCyberIT` (verificato con API: 1 repository pubblico).

#### Distribuzione delle 155 voci

| Edizione / percorso | Voci | Intervallo ID Training |
| --- | ---: | --- |
| 2026 territoriale | 11 | 753–763 |
| 2025 nazionale | 12 | 722–733 |
| 2025 territoriale | 11 | 711–721 |
| 2024 nazionale | 12 | 645–656 |
| 2024 territoriale | 11 | 612–622 |
| 2023 nazionale | 12 | 429–440 |
| 2023 territoriale | 11 | 394–404 |
| 2023 Training Camp 3 | 11 | 383–393 |
| 2023 Training Camp 2 | 11 | 372–382 |
| 2023 Training Camp 1 | 11 | 361–371 |
| 2022 nazionale | 16 | 291–306 |
| 2022 territoriale | 10 | 228–237 |
| 2021 nazionale | 16 | 136–151 |

Categorie **dichiarate nei writeup** (non necessariamente identiche ai tag del portale): `binary` 41, `crypto` 41, `web` 40, `misc` 23, `network` 10.

### 2.2 Strumenti terzi (non usati per l'import)

| Fonte | URL | Licenza | Funzione | Perché non è una fonte di catalogo |
| --- | --- | --- | --- | --- |
| sCCraper-IT | https://github.com/s1lentCommit/sCCraper-IT | MIT | Scarica challenge e allegati via API | Richiede **email/password** dell'utente; non utilizzato |
| Olidump | https://github.com/Kerlooo/Olidump | CC-BY-4.0 | Scarica challenge per ID | Richiede credenziali in `.olicyber_login.json`; non utilizzato |
| utcq/oca | https://github.com/utcq/oca | nessuna | Analizzatore challenge | Richiede token personale; non utilizzato |
| OliCyberUCT | https://github.com/FLAK-ZOSO/OliCyberUCT | GPL-3.0 | Confronto utenti | Richiede token dal localStorage; non utilizzato |
| 00xFE/Olicyber | https://github.com/00xFE/Olicyber | nessuna | Flag e writeup | Raccolta di soluzioni |
| selisir/Olicyber | https://github.com/selisir/Olicyber | MIT | Flag e writeup | Raccolta di soluzioni |
| bosioF/OlicyberWriteUps | https://github.com/bosioF/OlicyberWriteUps | CC-BY-SA-4.0 | Writeup personali (~130 secondo la descrizione) | Raccolta di soluzioni |
| Privitorta/Training-OliCyber.IT-solutions | https://github.com/Privitorta/Training-OliCyber.IT-solutions | nessuna | Soluzioni e writeup | Raccolta di soluzioni |
| pall1986/SOLUZIONI-OLICYBER | https://github.com/pall1986/SOLUZIONI-OLICYBER | GPL-3.0 | Soluzioni | Raccolta di soluzioni |
| fabrizioaymone/ctf-writeups | https://github.com/fabrizioaymone/ctf-writeups | MIT | Writeup personali | Raccolta di soluzioni |

I conteggi di file Markdown dei repo terzi (es. 78 in `Privitorta`, 11 in `bosioF`) **non sono conteggi di challenge verificate**: più file possono descrivere la stessa challenge e la maggior parte non riporta ID Training nel percorso.

---

## 3. Dati disponibili per fonte

Legenda: ✅ presente · ⚠️ presente ma non ufficiale/parziale · ❌ assente

| Campo | Writeup ufficiali | Strumenti terzi (con autorizzazione) | Export admin ufficiale |
| --- | --- | --- | --- |
| ID originale / Training | ✅ (#challenge-N) | ✅ | ✅ |
| Titolo | ✅ (testo del link) | ✅ `title` | ✅ |
| Categoria | ⚠️ categoria del writeup | ✅ `tags` | ✅ |
| Autore | ✅ | ❌ | ⚠️ se presente |
| Punteggio | ❌ (solo `risoluzioni`) | ✅ `currentScore` | ✅ |
| Difficoltà | ❌ | ❌ (i tag non sono difficulty) | ⚠️ se presente |
| Descrizione ufficiale | ❌ | ✅ `description` | ✅ |
| Testo della challenge | ❌ | ✅ `description` | ✅ |
| Edizione / percorso | ✅ (intestazione sezione: nazionale, territoriale, camp) | ✅ `events` → `sections` | ✅ |
| Data pubblicazione | ❌ | ❌ | ⚠️ se presente |
| Stato disponibilità | ❌ | ⚠️ `state` (se esposto) | ✅ |
| URL originale | ✅ | ✅ | ✅ |
| Allegati (riferimenti) | ❌ (solo immagini nei writeup) | ✅ `files[{name,url}]` | ✅ |
| File di distribuzione | ❌ | ✅ scaricabili solo con sessione autorizzata | ✅ |
| Writeup / soluzioni | ✅ (**da escludere**) | ✅ (**da escludere**) | ❌ (non necessari) |

Lo schema osservato nel codice pubblico di `sCCraper-IT` (`GET /api/challenges` → `events[].sections[].challenges[]`, `GET /api/challenges/<id>` → `title`, `tags`, `currentScore`, `files[{name,url}]`, `hints`, `description`) e di `utcq/oca` (`title`, `tags`, `currentScore`, `files`, `description`) mostra **quali campi esisterebbero con un accesso autorizzato**. Nessuno di questi dati è stato scaricato: gli endpoint rispondono `LOGIN_REQUIRED` senza credenziali.

---

## 4. Verifica della corrispondenza con il portale Training

- **Cosa è verificabile:** tutte le 155 righe del README ufficiale contengono un link a `https://training.olicyber.it/challenges#challenge-<id>`. Questo dimostra che il repository ufficiale **dichiara** una corrispondenza tra writeup e ID del portale.
- **Cosa non è verificabile:** senza accesso non è possibile confermare che quegli ID esistano ancora, che i titoli coincidano, che lo stato sia attivo o che il portale contenga solo quelle challenge.
- **Problema di qualità rilevato:** l'ID `726` compare due volte nella sezione 2025 nazionale (`Party Mode` e `Live and Let Die`). È probabilmente un refuso nel README ufficiale. Un import automatico deve deduplicare e segnalare il conflitto, non scegliere arbitrariamente.
- **Conteggio totale ufficiale:** non è pubblico. `/api/currentUser` anonimo non espone conteggi; `/api/scoreboard` e `/api/challenges/scoreboard` richiedono login. Non è quindi possibile confrontare 154 con un totale ufficiale.

**Conclusione:** i writeup ufficiali sono una fonte autorevole per *ID, titolo, autore, categoria dichiarata, edizione e percorso*, ma **non sono il catalogo ufficiale** e non possono essere etichettati come tali.

---

## 5. Writeup e soluzioni: esclusione deliberata

È stato verificato un campione di writeup ufficiali: contengono sezioni `Soluzione`, `Exploit`, codice e in alcuni casi flag reali (es. `2021-nazionale/binary1.md` contiene una flag completa). Per questo motivo:

1. i file `.md` dei writeup **non sono** una fonte per descrizione/testo da mostrare nella libreria;
2. il contenuto dei writeup **non deve** entrare nel contesto dell'assistente AI;
3. l'importatore `scripts/import-catalog.mjs` scarta esplicitamente i campi `flag`, `solution`, `writeup` e interrompe l'import se rileva pattern di flag.

---

## 6. Licenze e condizioni di riutilizzo da verificare

| Fonte | Licenza | Azione richiesta prima del riutilizzo |
| --- | --- | --- |
| OliCyber.IT-Writeups | GPL-3.0 | Verificare se testi, titoli e immagini siano coperti dalla licenza o da diritti di terzi; attribuire e rispettare il copyleft per eventuali derivati. **Non copiare i writeup nel prodotto.** |
| CyberChallengeIT / CybersecNatLab | GPL-3.0 | Valida per codice dei servizi A/D, non automaticamente per testi delle challenge. |
| sCCraper-IT | MIT | Utilizzabile come riferimento di schema; non usato per scaricare dati. |
| Olidump | CC-BY-4.0 | Richiede attribuzione; non usato. |
| utcq/oca, 00xFE/Olicyber, Privitorta | nessuna licenza | **Nessun diritto di riutilizzo** senza autorizzazione esplicita. |
| selisir, fabrizioaymone | MIT | Riutilizzo consentito con attribuzione, ma sono soluzioni: escluse. |
| bosioF | CC-BY-SA-4.0 | Condivisa con attribuzione e share-alike; sono soluzioni: escluse. |
| Portale Training | da verificare | Controllare i termini del servizio e l'eventuale policy sui dati prima di pubblicare un catalogo derivato. |

**Non è stata ottenuta alcuna autorizzazione esplicita al riutilizzo dei testi delle challenge.** La licenza dei writeup non implica automaticamente il diritto di ripubblicare il testo ufficiale delle challenge.

---

## 7. Strategia di integrazione proposta

### Livello A — Catalogo authoritative (export autorizzato)

1. L'utente esporta legalmente il catalogo con il proprio account (es. `/api/admin/challenges/export` con token proprio, oppure un export concordato con i mantenitori).
2. L'export viene salvato come file JSON locale e passato a:
   ```bash
   node scripts/import-catalog.mjs --file export-autorizzato.json --expected-total <N>
   ```
3. L'importatore deduplica, valida lo schema, rimuove campi sensibili, calcola il report e scrive `public/data/challenges.json` + `public/data/import-report.json`.
4. Lo status diventa `verified-import` **solo se** `imported === expectedTotal`; altrimenti `imported-unverified`.

### Livello B — Indice pubblico di cross-reference (separato, non catalogo)

Da generare in un file distinto, ad esempio `docs/research/writeups-index.json`, con soli campi non sensibili:

```json
{
  "trainingId": "753",
  "titleFromWriteup": "Trace the void",
  "categoryFromWriteup": "binary",
  "authorFromWriteup": "Alberto Carboneri <@Alberto247>",
  "edition": "2026",
  "path": "territoriale",
  "sourceUrl": "https://github.com/OliCyberIT/OliCyber.IT-Writeups/blob/master/2026-territoriale/binary1.md",
  "trainingUrl": "https://training.olicyber.it/challenges#challenge-753",
  "provenance": { "type": "public-writeup-index", "verifiedAgainstOfficialCatalog": false }
}
```

Regole:
- usato **solo** per riconciliare ID, rilevare record mancanti e segnalare conflitti (come l'ID 726 duplicato);
- **mai** fuso nel catalogo ufficiale senza conferma dell'export autorizzato;
- **nessun** campo `description`, `statement`, `flag`, `solution`, `writeup`;
- ogni record conserva `provenance.type` e `verifiedAgainstOfficialCatalog`.

### Livello C — Provenienza per record

Ogni challenge del catalogo mantiene:

```json
"provenance": {
  "source": "Export admin OliCyber 2026",
  "sourceUrl": "...",
  "importedAt": "2026-...",
  "sourceType": "authorized-export",
  "verified": true
}
```

In caso di conflitto, l'export autorizzato prevale sempre; l'indice pubblico può solo aggiungere una nota di cross-reference. I dati personali (stati, conversazioni, preferenze) restano in `localStorage` con chiavi separate: un aggiornamento del catalogo non li sovrascrive mai.

---

## 8. Limiti dell'analisi

1. Accesso anonimo: tutti gli endpoint Challenge del portale rispondono `LOGIN_REQUIRED`.
2. Nessun totale ufficiale pubblico: completezza non verificabile.
3. Writeup = soluzioni: non utilizzabili come materiale didattico predefinito.
4. Categorie dei writeup potrebbero non corrispondere ai tag del portale (`binary` vs `software`).
5. ID duplicato 726 nel README ufficiale: da segnalare, non da risolvere inventando dati.
6. GitHub API senza token: code search non disponibile; repository privati o non indicizzati non sono stati censiti.
7. Nessun contatto con i mantenitori per chiarire licenze o ottenere un export autorizzato.
8. Non è stato verificato lo stato attuale (attivo/disponibile) degli ID censiti.

---

## 9. Cosa serve per completare il catalogo reale

- Un **export autorizzato** del catalogo Training (o l'autorizzazione scritta a usare l'endpoint admin con token proprio).
- Il **numero totale ufficiale** delle challenge, per poter dichiarare la completezza.
- Conferma delle **condizioni di riutilizzo** dei testi delle challenge.
- Eventuale elenco ufficiale di corrispondenza ID ↔ edizione/percorso per risolvere il conflitto sull'ID 726.

Finché questi elementi non sono disponibili, il catalogo dell'applicazione resta esplicitamente `unverified-demo` e il report di importazione dichiara `verifiedAgainstSource: false`.

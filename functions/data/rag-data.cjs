/**
 * Ponte CJS per l'indice RAG generato da scripts/import-browser-export.mjs.
 *
 * Come per il catalogo, il require statico viene inlined sia da Wrangler 3 sia
 * da Wrangler 4. L'indice resta lato server: non è un file in public/ e non è
 * raggiungibile come risorsa statica.
 */
module.exports = require('./rag-index.json');

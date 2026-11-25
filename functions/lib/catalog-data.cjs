/**
 * Ponte CJS per il catalogo statico.
 *
 * Le build Git-integrate di Pages compilano le Functions con Wrangler 3, che
 * non supporta gli import attributes ESM (`with { type: 'json' }`). Il require
 * statico viene risolto e inlined da Wrangler 3 e 4, ed è supportato da Node
 * nei test: una sola sorgente dati, senza duplicazioni né binding Node a runtime.
 */
module.exports = require('../../public/data/challenges.json');

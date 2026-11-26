import { DEFAULT_MODEL } from '../lib/model.js';
import { CATALOG_META } from '../lib/catalog.js';
import { RAG_META } from '../lib/rag.js';

function configuredModel(env) {
  const candidate = typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : '';
  return /^@cf\/[a-zA-Z0-9._/-]{3,120}$/.test(candidate) ? candidate : DEFAULT_MODEL;
}

export async function onRequestGet({ env }) {
  const enabled = Boolean(env.AI);
  return new Response(JSON.stringify({
    mode: enabled ? 'ai' : 'demo',
    model: enabled ? configuredModel(env) : null,
    note: enabled
      ? 'Binding AI configurato: le risposte sono generate dal modello.'
      : 'Binding AI non configurato: il backend risponde in modalità DEMO.',
    catalog: {
      schemaVersion: CATALOG_META.schemaVersion,
      status: CATALOG_META.status,
      verified: CATALOG_META.source.verified === true,
      imported: CATALOG_META.completeness.imported,
      source: CATALOG_META.source.name,
      lastSync: CATALOG_META.source.importedAt,
    },
    rag: {
      connected: RAG_META.connected,
      documents: RAG_META.documents,
      chunks: RAG_META.chunks,
      generatedAt: RAG_META.generatedAt,
      source: RAG_META.source,
      settings: RAG_META.settings,
    },
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

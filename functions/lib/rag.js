/**
 * Nomi storici mantenuti come alias per compatibilità con codice e test
 * esistenti. Il retrieval del tutor usa ESCLUSIVAMENTE la knowledge base
 * didattica separata: nessun testo delle challenge raggiunge il modello.
 */

export {
  KNOWLEDGE_META as RAG_META,
  retrieveKnowledge as retrieveRag,
  knowledgeContext as ragContext,
  publicKnowledgeSources as publicSources,
} from './knowledge.js';

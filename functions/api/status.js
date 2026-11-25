const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8';

export async function onRequestGet({ env }) {
  const enabled = Boolean(env.AI);
  return new Response(JSON.stringify({
    mode: enabled ? 'ai' : 'demo',
    model: enabled ? (env.AI_MODEL || DEFAULT_MODEL) : null,
    note: enabled
      ? 'Assistente AI configurato.'
      : 'Binding AI non configurato: il backend risponde in modalità DEMO.',
  }), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

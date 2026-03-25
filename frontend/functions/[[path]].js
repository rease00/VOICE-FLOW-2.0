import worker from '../.open-next/worker.js';

export async function onRequest(context) {
  return worker.fetch(context.request, context.env, context);
}

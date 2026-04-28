import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { backendFetch } from '../lib/backend';

async function proxyRequest({ request, context }: LoaderFunctionArgs | ActionFunctionArgs) {
  const backendEnv = (context as any)?.cloudflare?.env;
  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const body = hasBody ? await request.clone().arrayBuffer() : undefined;

  return backendFetch(request.url, {
    env: backendEnv,
    request,
    method,
    headers: request.headers,
    body,
  });
}

export async function loader(args: LoaderFunctionArgs) {
  return proxyRequest(args);
}

export async function action(args: ActionFunctionArgs) {
  return proxyRequest(args);
}

export default function ApiProxyRoute() {
  return null;
}

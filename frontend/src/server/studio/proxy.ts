import type { NextRequest } from 'next/server';

import { proxyBackendRequest } from '../../../app/api/backend/proxy';
import { isStudioProxyMode } from './mode';

const STUDIO_COMPATIBLE_ROOT_SEGMENTS = new Set(['ai', 'health', 'routing', 'runtime', 'tts']);

const isStudioCompatibilityPath = (pathSegments: string[]): boolean => {
  const root = String(pathSegments[0] || '').trim().toLowerCase();
  return STUDIO_COMPATIBLE_ROOT_SEGMENTS.has(root);
};

const withStudioCompatibilityHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set('x-vf-studio-compatibility', 'true');
  headers.set('x-vf-canonical-api-base', '/api/v1/studio');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const proxyWhenStudioMode = async (
  request: NextRequest,
  pathSegments: string[],
): Promise<Response | null> => {
  if (!isStudioProxyMode()) {
    return null;
  }
  return withStudioCompatibilityHeaders(await proxyBackendRequest(request, pathSegments));
};

export const proxyStudioCompatibilityRequest = async (
  request: NextRequest,
  pathSegments: string[],
): Promise<Response> => {
  if (!isStudioCompatibilityPath(pathSegments)) {
    return Response.json(
      { error: 'Studio compatibility path not found.' },
      { status: 404 },
    );
  }
  return withStudioCompatibilityHeaders(await proxyBackendRequest(request, pathSegments));
};

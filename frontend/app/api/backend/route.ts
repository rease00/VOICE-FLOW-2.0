import { NextRequest } from 'next/server';
import { proxyBackendRequest } from './proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: NextRequest) => proxyBackendRequest(request);
export const POST = (request: NextRequest) => proxyBackendRequest(request);
export const PUT = (request: NextRequest) => proxyBackendRequest(request);
export const PATCH = (request: NextRequest) => proxyBackendRequest(request);
export const DELETE = (request: NextRequest) => proxyBackendRequest(request);
export const HEAD = (request: NextRequest) => proxyBackendRequest(request);
export const OPTIONS = (request: NextRequest) => proxyBackendRequest(request);

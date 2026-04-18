import {
  generateTextWithVertex,
  isVertexTextConfigured,
} from '../vertexTextService';
import { verifyFirebaseRequest } from '../auth/requestAuth.ts';

interface GenerateTextRequestBody {
  systemPrompt?: string;
  userPrompt?: string;
  jsonMode?: boolean;
  temperature?: number;
}

const json = (payload: unknown, init?: ResponseInit): Response => Response.json(payload, init);

const errorResponse = (status: number, detail: string): Response => (
  json({ detail }, { status })
);

const isUnauthorizedAiRequestError = (error: unknown): boolean => {
  const message = error instanceof Error ? String(error.message || '').trim().toLowerCase() : '';
  if (!message) return false;
  return (
    message.includes('missing authorization')
    || message.includes('id token')
    || message.includes('session cookie')
    || message.includes('auth')
    || message.includes('token')
  );
};

const parseJsonBody = async <T>(request: Request): Promise<T | null> => {
  try {
    return await request.json() as T;
  } catch {
    return null;
  }
};

export const handleAiGenerateTextRoute = async (request: Request): Promise<Response> => {
  try {
    if (!isVertexTextConfigured()) {
      return errorResponse(503, 'Vertex text service is not configured.');
    }

    await verifyFirebaseRequest(request);

    const body = await parseJsonBody<GenerateTextRequestBody>(request);
    const systemPrompt = String(body?.systemPrompt || '').trim();
    const userPrompt = String(body?.userPrompt || '').trim();
    const jsonMode = Boolean(body?.jsonMode);
    const temperature = Number.isFinite(Number(body?.temperature))
      ? Number(body?.temperature)
      : 0.2;

    if (!userPrompt) {
      return errorResponse(400, 'userPrompt is required.');
    }

    const text = await generateTextWithVertex({
      systemPrompt,
      userPrompt,
      jsonMode,
      temperature,
    });

    return json({ text });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'AI text generation failed.';
    const status = detail.toLowerCase().includes('not configured')
      ? 503
      : isUnauthorizedAiRequestError(error)
        ? 401
        : 500;
    return errorResponse(status, detail);
  }
};

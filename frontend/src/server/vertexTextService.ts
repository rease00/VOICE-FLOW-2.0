import { GoogleAuth } from 'google-auth-library';
import {
  getGoogleCloudAuthOptions,
  resolveGoogleCloudLocation,
  resolveGoogleCloudProjectId,
  resolveVertexServiceAccountPool,
  type GoogleServiceAccount,
} from './googleCredentials';

const DEFAULT_TRANSLATION_MODEL = String(
  process.env.VF_READER_TRANSLATION_MODEL
  || process.env.VF_AI_TEXT_DEFAULT_MODEL
  || 'gemini-2.5-flash-lite',
).trim() || 'gemini-2.5-flash-lite';

const MAX_TRANSLATION_CHARS = 20_000;
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const authClientCache = new Map<string, Promise<Awaited<ReturnType<GoogleAuth['getClient']>>>>();

const sanitizeText = (value: string): string => (
  String(value || '')
    .replace(/\r/g, '\n')
    .trim()
);

const getVertexProjectId = (credentials: GoogleServiceAccount): string => (
  resolveGoogleCloudProjectId(credentials.projectId) || credentials.projectId
);

const getVertexClientKey = (credentials: GoogleServiceAccount): string => (
  `${getVertexProjectId(credentials)}:${resolveGoogleCloudLocation()}:${credentials.clientEmail}`
);

const getAuthClient = async (credentials: GoogleServiceAccount) => {
  const cacheKey = getVertexClientKey(credentials);
  const cached = authClientCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const auth = new GoogleAuth({
    ...getGoogleCloudAuthOptions(credentials),
    scopes: [CLOUD_PLATFORM_SCOPE],
  });
  const clientPromise = auth.getClient();
  authClientCache.set(cacheKey, clientPromise);
  return clientPromise;
};

const buildVertexGenerateContentUrl = (credentials: GoogleServiceAccount): string => {
  const project = getVertexProjectId(credentials);
  const location = resolveGoogleCloudLocation();
  return [
    `https://${location}-aiplatform.googleapis.com/v1`,
    `projects/${project}`,
    `locations/${location}`,
    'publishers/google',
    `models/${DEFAULT_TRANSLATION_MODEL}:generateContent`,
  ].join('/');
};

const extractCandidateText = (data: unknown): string => {
  const response = data as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  return String(
    response.candidates?.[0]?.content?.parts
      ?.map((part) => String(part?.text || ''))
      .join('') || '',
  ).trim();
};

export const isVertexTextConfigured = (): boolean => {
  try {
    return resolveVertexServiceAccountPool().length > 0;
  } catch {
    return false;
  }
};

export interface VertexTranslationInput {
  text: string;
  targetLanguage: string;
}

export interface VertexGenerateTextInput {
  systemPrompt: string;
  userPrompt: string;
  jsonMode?: boolean;
  temperature?: number;
}

export const buildReaderModernizePrompt = (input: VertexTranslationInput): string => {
  return [
    `Rewrite the text inside <text> tags into contemporary ${input.targetLanguage} for a fast, low-latency audiobook narration flow.`,
    'Preserve names, plot facts, scene intent, paragraph breaks, chapter layout, and dialogue structure exactly.',
    'Keep slang only when the source already contains slang.',
    'Do not inject new slang into neutral or formal narration.',
    'Do not add commentary, markdown, labels, translator notes, or explanations.',
    'Return only the final rewritten text.',
    '<text>',
    input.text,
    '</text>',
  ].join('\n');
};

export const translateTextWithVertex = async (
  input: VertexTranslationInput,
): Promise<string> => {
  const text = sanitizeText(input.text);
  const targetLanguage = sanitizeText(input.targetLanguage);

  if (!text) {
    throw new Error('text is required.');
  }
  if (!targetLanguage) {
    throw new Error('targetLanguage is required.');
  }
  if (text.length > MAX_TRANSLATION_CHARS) {
    throw new Error(`text exceeds ${MAX_TRANSLATION_CHARS} character limit.`);
  }

  const prompt = buildReaderModernizePrompt({ text, targetLanguage });

  let lastError: Error | null = null;
  for (const credentials of resolveVertexServiceAccountPool()) {
    try {
      const client = await getAuthClient(credentials);
      const response = await client.request<{
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      }>({
        url: buildVertexGenerateContentUrl(credentials),
        method: 'POST',
        data: {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
          },
        },
      });

      const translated = extractCandidateText(response.data);
      if (!translated) {
        throw new Error('Vertex AI returned empty translated text.');
      }
      return translated;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `All Vertex AI credentials failed. Last error: ${lastError?.message || 'unknown'}`,
  );
};

export const generateTextWithVertex = async (
  input: VertexGenerateTextInput,
): Promise<string> => {
  const systemPrompt = sanitizeText(input.systemPrompt);
  const userPrompt = sanitizeText(input.userPrompt);
  const jsonMode = Boolean(input.jsonMode);
  const temperature = Number.isFinite(Number(input.temperature))
    ? Math.max(0, Math.min(1, Number(input.temperature)))
    : 0.2;

  if (!userPrompt) {
    throw new Error('userPrompt is required.');
  }

  let lastError: Error | null = null;
  for (const credentials of resolveVertexServiceAccountPool()) {
    try {
      const client = await getAuthClient(credentials);
      const response = await client.request<{
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      }>({
        url: buildVertexGenerateContentUrl(credentials),
        method: 'POST',
        data: {
          ...(systemPrompt
            ? {
                systemInstruction: {
                  role: 'system',
                  parts: [{ text: systemPrompt }],
                },
              }
            : {}),
          contents: [
            {
              role: 'user',
              parts: [{ text: userPrompt }],
            },
          ],
          generationConfig: {
            temperature,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        },
      });

      const generated = extractCandidateText(response.data);
      if (!generated) {
        throw new Error('Vertex AI returned empty generated text.');
      }
      return generated;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `All Vertex AI credentials failed. Last error: ${lastError?.message || 'unknown'}`,
  );
};

export { DEFAULT_TRANSLATION_MODEL, MAX_TRANSLATION_CHARS };

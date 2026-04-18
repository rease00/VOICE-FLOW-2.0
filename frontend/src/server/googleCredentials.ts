import fs from 'node:fs';
import path from 'node:path';

export interface GoogleServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  privateKeyId?: string;
  source: string;
}

interface RawServiceAccount {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  private_key_id?: string;
}

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const readTrimmedEnv = (...keys: string[]): string => {
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) return value;
  }
  return '';
};

const readListEnv = (...keys: string[]): string[] => {
  const values: string[] = [];
  for (const key of keys) {
    const raw = String(process.env[key] || '').trim();
    if (!raw) continue;
    for (const candidate of raw.split(/[\r\n,;]+/)) {
      const value = candidate.trim();
      if (value) values.push(value);
    }
  }
  return values;
};

const normalizeServiceAccount = (
  raw: RawServiceAccount,
  source: string,
): GoogleServiceAccount => {
  const projectId = String(raw.project_id || '').trim();
  const clientEmail = String(raw.client_email || '').trim();
  const privateKey = String(raw.private_key || '').replace(/\\n/g, '\n').trim();
  const privateKeyId = String(raw.private_key_id || '').trim();

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(`Service account from ${source} is missing required fields.`);
  }

  return {
    projectId,
    clientEmail,
    privateKey,
    source,
    ...(privateKeyId ? { privateKeyId } : {}),
  };
};

const loadServiceAccountFile = (filePath: string): GoogleServiceAccount => {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, 'utf8');
  return normalizeServiceAccount(JSON.parse(raw) as RawServiceAccount, resolved);
};

const loadServiceAccountJson = (rawJson: string, source: string): GoogleServiceAccount => {
  return normalizeServiceAccount(JSON.parse(rawJson) as RawServiceAccount, source);
};

const appendUniqueAccount = (
  pool: GoogleServiceAccount[],
  account: GoogleServiceAccount | null,
): void => {
  if (!account) return;
  if (pool.some((item) => (
    item.projectId === account.projectId && item.clientEmail === account.clientEmail
  ))) {
    return;
  }
  pool.push(account);
};

const loadInlineFirebaseServiceAccount = (): GoogleServiceAccount | null => {
  const projectId = String(process.env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(process.env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }
  return {
    projectId,
    clientEmail,
    privateKey,
    source: 'inline:FIREBASE_*',
  };
};

const buildInlineCloudTtsPool = (): GoogleServiceAccount[] => {
  const pool: GoogleServiceAccount[] = [];
  const specs = [
    {
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
      clientEmail: process.env.GOOGLE_CLOUD_CLIENT_EMAIL,
      privateKey: process.env.GOOGLE_CLOUD_PRIVATE_KEY,
      source: 'inline:GOOGLE_CLOUD_*',
    },
    {
      projectId: process.env.GCP_TTS_BACKUP1_PROJECT_ID,
      clientEmail: process.env.GCP_TTS_BACKUP1_CLIENT_EMAIL,
      privateKey: process.env.GCP_TTS_BACKUP1_PRIVATE_KEY,
      source: 'inline:GCP_TTS_BACKUP1_*',
    },
    {
      projectId: process.env.GCP_TTS_BACKUP2_PROJECT_ID,
      clientEmail: process.env.GCP_TTS_BACKUP2_CLIENT_EMAIL,
      privateKey: process.env.GCP_TTS_BACKUP2_PRIVATE_KEY,
      source: 'inline:GCP_TTS_BACKUP2_*',
    },
  ];

  for (const spec of specs) {
    const projectId = String(spec.projectId || '').trim();
    const clientEmail = String(spec.clientEmail || '').trim();
    const privateKey = String(spec.privateKey || '').replace(/\\n/g, '\n').trim();
    if (!projectId || !clientEmail || !privateKey) continue;
    pool.push({
      projectId,
      clientEmail,
      privateKey,
      source: spec.source,
    });
  }

  return pool;
};

const tryLoadFromPath = (envKey: string): GoogleServiceAccount | null => {
  const candidate = readTrimmedEnv(envKey);
  if (!candidate) return null;
  return loadServiceAccountFile(candidate);
};

const tryLoadFromJson = (envKey: string): GoogleServiceAccount | null => {
  const candidate = readTrimmedEnv(envKey);
  if (!candidate) return null;
  return loadServiceAccountJson(candidate, `env:${envKey}`);
};

const tryLoadManyFromPaths = (...envKeys: string[]): GoogleServiceAccount[] => {
  const pool: GoogleServiceAccount[] = [];
  for (const candidate of readListEnv(...envKeys)) {
    try {
      appendUniqueAccount(pool, loadServiceAccountFile(candidate));
    } catch {
      // Ignore invalid or missing candidates so we can fall back to other configured keys.
    }
  }
  return pool;
};

export const resolveFirebaseAdminServiceAccount = (): GoogleServiceAccount => {
  return (
    tryLoadFromJson('FIREBASE_SERVICE_ACCOUNT_JSON')
    || tryLoadFromPath('GOOGLE_APPLICATION_CREDENTIALS')
    || loadInlineFirebaseServiceAccount()
    || (() => {
      throw new Error(
        'Firebase Admin credentials are not configured. Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON.'
      );
    })()
  );
};

export const resolveVertexServiceAccount = (): GoogleServiceAccount => {
  return resolveVertexServiceAccountPool()[0]
    || (() => {
      throw new Error(
        'Vertex AI credentials are not configured. Set VF_GEMINI_VERTEX_SERVICE_ACCOUNT_FILE or GOOGLE_APPLICATION_CREDENTIALS.'
      );
    })();
};

export const resolveVertexServiceAccountPool = (): GoogleServiceAccount[] => {
  const pool: GoogleServiceAccount[] = [];
  for (const account of tryLoadManyFromPaths(
    'VF_GEMINI_VERTEX_SERVICE_ACCOUNT_FILE',
    'GOOGLE_APPLICATION_CREDENTIALS',
  )) {
    appendUniqueAccount(pool, account);
  }
  return pool;
};

export const resolveCloudTtsCredentialPool = (): GoogleServiceAccount[] => {
  const pool: GoogleServiceAccount[] = [];
  for (const account of tryLoadManyFromPaths(
    'VF_TTS_TEXTTOSPEECH_SERVICE_ACCOUNT_FILE',
    'GOOGLE_APPLICATION_CREDENTIALS',
  )) {
    appendUniqueAccount(pool, account);
  }
  const inlinePool = buildInlineCloudTtsPool();
  for (const account of inlinePool) {
    appendUniqueAccount(pool, account);
  }
  return pool;
};

export const resolveGoogleCloudProjectId = (fallback?: string): string => {
  return (
    readTrimmedEnv(
      'VF_GOOGLE_CLOUD_PROJECT',
      'VF_GEMINI_VERTEX_PROJECT',
      'GCLOUD_PROJECT',
    )
    || fallback
    || readTrimmedEnv('GOOGLE_CLOUD_PROJECT')
    || ''
  );
};

export const resolveGoogleCloudLocation = (): string => {
  return readTrimmedEnv(
    'VF_GEMINI_VERTEX_LOCATION',
    'VF_GOOGLE_CLOUD_LOCATION',
    'VERTEX_LOCATION',
  ) || 'us-central1';
};

export const resolveCloudTtsApiEndpoint = (): string => {
  const raw = readTrimmedEnv('VF_TTS_TEXTTOSPEECH_ENDPOINT');
  if (!raw) {
    const region = readTrimmedEnv('VF_TTS_TEXTTOSPEECH_REGION', 'VF_READER_TTS_REGION').toLowerCase();
    if (!region || region === 'global') {
      return 'texttospeech.googleapis.com';
    }
    return `${region}-texttospeech.googleapis.com`;
  }

  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return parsed.host || 'texttospeech.googleapis.com';
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .trim() || 'texttospeech.googleapis.com';
  }
};

export const getGoogleCloudAuthOptions = (account: GoogleServiceAccount) => ({
  credentials: {
    client_email: account.clientEmail,
    private_key: account.privateKey,
    project_id: account.projectId,
    ...(account.privateKeyId ? { private_key_id: account.privateKeyId } : {}),
  },
  projectId: account.projectId,
  scopes: [CLOUD_PLATFORM_SCOPE],
});

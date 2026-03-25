const CHUNK_SIZE = 8192;

export const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + CHUNK_SIZE, bytes.byteLength)));
  }
  return btoa(binary);
};

export const blobToBase64 = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  return arrayBufferToBase64(buffer);
};

export const fileToBase64 = async (file: File): Promise<string> => {
  return blobToBase64(file);
};

export const fetchUrlToBase64 = async (url: string): Promise<string> => {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const response = await fetch(raw);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  if (!buffer.byteLength) {
    throw new Error('Empty audio response');
  }
  return arrayBufferToBase64(buffer);
};

export const base64ToArrayBuffer = (encoded: string): ArrayBuffer => {
  const safe = String(encoded || '').trim();
  if (!safe) return new ArrayBuffer(0);
  const binary = atob(safe);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return buffer;
};

export const DEFAULT_CHUNK_LIMIT = 500;

export function splitIntoChunks(text: string, chunkLimit = DEFAULT_CHUNK_LIMIT): string[] {
  const source = (text || '').trim();
  if (!source) return [];

  const paragraphs = source
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    if ((current + paragraph).length > chunkLimit && current) {
      chunks.push(current.trim());
      current = paragraph;
      continue;
    }

    current += `${current ? '\n\n' : ''}${paragraph}`;
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function tokenizeParagraph(paragraph: string): string[] {
  if (!paragraph) return [];
  return paragraph.split(/(\s+)/);
}

export function splitIntoSentenceChunks(
  text: string,
  chunkLimit: number = DEFAULT_CHUNK_LIMIT
): string[] {
  const source = (text || '').trim();
  if (!source) return [];

  const limit = Math.max(500, Math.min(4500, chunkLimit));

  const sentences = source
    .replace(/\n{2,}/g, '\n')
    .split(/(?<=[.!?…»"'\u201D\u300D])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;

    if (candidate.length > limit && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

export function splitIntoDialogChunks(
  text: string,
  chunkLimit: number = DEFAULT_CHUNK_LIMIT
): string[] {
  const source = (text || '').trim();
  if (!source) return [];

  const blocks = source.split(/(?=\[SPEAKER:\s*[^\]]+\])/);
  const limit = Math.max(200, Math.min(4000, chunkLimit));
  const chunks: string[] = [];
  let current = '';

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const candidate = current ? `${current}\n\n${trimmed}` : trimmed;

    if (candidate.length > limit && current) {
      chunks.push(current.trim());
      if (trimmed.length > limit) {
        const subChunks = splitIntoSentenceChunks(trimmed, limit);
        chunks.push(...subChunks.slice(0, -1));
        current = subChunks[subChunks.length - 1] || '';
      } else {
        current = trimmed;
      }
    } else {
      current = candidate;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

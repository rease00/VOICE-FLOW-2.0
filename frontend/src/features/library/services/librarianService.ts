import { GoogleGenAI, Chat } from "@google/genai";

export type { Chat } from '@google/genai';

const getClient = () => {
  const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    console.warn("API_KEY is missing. Gemini features will not work.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const createLibrarianChat = (): Chat | null => {
  const client = getClient();
  if (!client) return null;

  return client.chats.create({
    model: 'gemini-2.5-flash',
    config: {
      systemInstruction: `You are the "V Flow Librarian", a knowledgeable, warm, and sophisticated expert on literature. 
      You help users find books, understand complex themes, and explore the history of literature.
      The user is browsing a library of public domain books (Project Gutenberg).
      Keep your answers concise, engaging, and formatting with Markdown where appropriate.
      If asked for recommendations, try to suggest classics available in the public domain.`,
    }
  });
};

export const analyzeBook = async (title: string, author: string, context?: string): Promise<string> => {
  const client = getClient();
  if (!client) return "AI services are currently unavailable. Please check your API key.";

  try {
    const prompt = `Provide a concise, intriguing summary and thematic analysis of the book "${title}" by ${author}. 
    ${context ? `Also, answer this specific question about it: "${context}"` : ''}
    Focus on why it is significant in literature history. Keep it under 200 words.`;

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "No analysis available.";
  } catch (error) {
    console.error("Gemini analysis failed:", error);
    return "Could not analyze this book at the moment.";
  }
};

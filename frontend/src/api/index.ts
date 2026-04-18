import { RequestConfig, ApiClient } from './apiClient';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

const requestConfig: RequestConfig = {
  baseURL: API_BASE_URL,
  timeout: 10000,
};

export const apiClient = new ApiClient(requestConfig);

// Auth API
export const authApi = {
  login: (email: string, password: string) => 
    apiClient.post('/api/auth/login', { email, password }),
  
  register: (email: string, password: string, displayName: string) => 
    apiClient.post('/api/auth/register', { email, password, displayName }),
  
  getProfile: () => apiClient.get('/api/auth/me'),
  
  logout: () => apiClient.post('/api/auth/logout', {}),
};

// TTS API
export const ttsApi = {
  synthesize: (text: string, voice: string, languageCode = 'en-US', audioConfig?: any) => 
    apiClient.post('/api/tts/synthesize', { text, voice, languageCode, audioConfig }),
  
  getVoices: () => apiClient.get('/api/tts/voices'),
};

// Voice API
export const voiceApi = {
  getVoices: (userId: string) => apiClient.get(`/api/voices/${userId}`),
  createVoice: (name: string, description: string, audioSample: string) => 
    apiClient.post('/api/voices', { name, description, audioSample }),
  updateVoice: (voiceId: string, updates: any) => 
    apiClient.put(`/api/voices/${voiceId}`, updates),
  deleteVoice: (voiceId: string) => 
    apiClient.delete(`/api/voices/${voiceId}`),
};

// Book API
export const bookApi = {
  getBooks: (userId: string) => apiClient.get(`/api/books/${userId}`),
  createBook: (title: string, description: string, coverImage?: string) => 
    apiClient.post('/api/books', { title, description, coverImage }),
  getChapters: (bookId: string) => apiClient.get(`/api/books/chapters/${bookId}`),
  addChapter: (bookId: string, title: string, content: string, order: number) => 
    apiClient.post('/api/books/chapters', { bookId, title, content, order }),
  generateChapterAudio: (chapterId: string, voiceId: string, narrationStyle?: string) => 
    apiClient.post(`/api/books/chapters/${chapterId}/generate`, { voiceId, narrationStyle }),
};

// Studio API
export const studioApi = {
  getProjects: (userId: string) => apiClient.get(`/api/studio/${userId}/projects`),
  createProject: (name: string, description: string, projectType: string) => 
    apiClient.post('/api/studio/projects', { name, description, projectType }),
  addToQueue: (projectId: string, audioData: string, priority: number) => 
    apiClient.post('/api/studio/queue', { projectId, audioData, priority }),
  getQueue: (projectId: string) => apiClient.get(`/api/studio/queue/${projectId}`),
  processQueue: (queueIds: string[]) => 
    apiClient.post('/api/studio/queue/process', { queueIds }),
};

// Admin API
export const adminApi = {
  getHealth: () => apiClient.get('/api/admin/health'),
  getMetrics: () => apiClient.get('/api/admin/metrics'),
  getUsers: () => apiClient.get('/api/admin/users'),
};

export default apiClient;

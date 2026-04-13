export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Voice {
  id: string;
  name: string;
  description?: string;
  userId: string;
  audioSample?: string;
  isCloned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Book {
  id: string;
  title: string;
  description?: string;
  coverImage?: string;
  userId: string;
  chapterCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chapter {
  id: string;
  bookId: string;
  title: string;
  content: string;
  order: number;
  audioUrl?: string;
  duration?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AudioGeneration {
  id: string;
  userId: string;
  type: 'tts' | 'voice-clone' | 'book-chapter';
  input: string;
  voiceId?: string;
  outputUrl?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
}

export interface StudioProject {
  id: string;
  name: string;
  description?: string;
  userId: string;
  projectType: 'audio-book' | 'podcast' | 'voice-clone' | 'other';
  status: 'draft' | 'in-progress' | 'completed' | 'published';
  createdAt: Date;
  updatedAt: Date;
}

export interface QueueItem {
  id: string;
  projectId: string;
  audioData: string;
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retries: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}
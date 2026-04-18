export interface RequestConfig {
  baseURL: string;
  timeout?: number;
}

const mergeHeaders = (headers: HeadersInit | undefined): Headers => new Headers(headers);

export class ApiClient {
  private readonly baseURL: string;
  private readonly timeout: number;

  constructor(config: RequestConfig) {
    this.baseURL = String(config.baseURL || '').replace(/\/+$/, '');
    this.timeout = config.timeout ?? 10_000;
  }

  private buildUrl(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseURL}${normalizedPath}`;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = mergeHeaders(init.headers);
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      const response = await fetch(this.buildUrl(path), {
        ...init,
        headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(detail || `${response.status} ${response.statusText}`);
      }

      if (response.status === 204) {
        return undefined as T;
      }

      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'DELETE' });
  }
}

export class HttpError extends Error {
  status: number;
  statusText: string;
  detail: string;

  constructor(status: number, statusText: string, detail: string) {
    super(detail || `${status} ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.detail = detail || `${status} ${statusText}`;
  }
}

export const parseResponseError = async (response: Response): Promise<HttpError> => {
  let detail = `${response.status} ${response.statusText}`;
  try {
    const payload = await response.json();
    const apiDetail = String(payload?.detail || payload?.error || '').trim();
    if (apiDetail) detail = apiDetail;
  } catch {
    // no-op
  }
  return new HttpError(response.status, response.statusText, detail);
};

export const readJsonOrThrow = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw await parseResponseError(response);
  }
  return response.json() as Promise<T>;
};

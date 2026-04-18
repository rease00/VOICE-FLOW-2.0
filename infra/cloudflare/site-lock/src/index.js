const PRIVATE_HEADER_VALUE = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

const decorateResponse = (response) => {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', PRIVATE_HEADER_VALUE);
  headers.set('X-V-Flow-AI-Lock', 'disabled');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export default {
  async fetch(request) {
    const response = await fetch(request);
    return decorateResponse(response);
  },
};

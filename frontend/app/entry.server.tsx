import { renderToReadableStream } from "react-dom/server";
import { ServerRouter, type EntryContext } from "react-router";

export default async function handleRequest(
  request: Request,
  statusCode: number,
  responseHeaders: Headers,
  context: EntryContext
) {
  const body = await renderToReadableStream(
    <ServerRouter context={context} url={request.url} />
  );

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, {
    headers: responseHeaders,
    status: statusCode
  });
}

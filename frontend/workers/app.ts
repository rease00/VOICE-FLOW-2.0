import { createRequestHandler } from "@react-router/cloudflare";
import { resolveBackendOrigin, resolveBackendTransport } from "../app/lib/backend";

type Env = {
  BACKEND?: Fetcher;
  BACKEND_SERVICE?: Fetcher;
  BACKEND_ORIGIN?: string;
  API_ORIGIN?: string;
  VF_BACKEND_ORIGIN?: string;
  VF_API_ORIGIN?: string;
};

const requestHandler = createRequestHandler(
  {
    build: async () => {
      const mod = await import("virtual:react-router/server-build");
      return (mod.default ?? mod) as any;
    },
    mode: import.meta.env.MODE,
    getLoadContext({ context }) {
      const env = context.cloudflare.env as Env;
      return {
        cloudflare: context.cloudflare,
        backend: resolveBackendTransport(env),
        backendOrigin: resolveBackendOrigin(env)
      };
    }
  }
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler({
      request,
      env,
      waitUntil: ctx.waitUntil.bind(ctx),
      passThroughOnException: ctx.passThroughOnException.bind(ctx)
    } as any);
  }
} satisfies ExportedHandler<Env>;

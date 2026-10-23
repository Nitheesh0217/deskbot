// Minimal compile-time edge surface; the deployed runtime supplies this object.
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};

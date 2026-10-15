declare module "cloudflare:workers" {
  export const env: {
    DB: import("@cloudflare/workers-types").D1Database;
    FILES: import("../app/lib/worker-bindings").MediaBucket;
  };
}

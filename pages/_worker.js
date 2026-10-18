// Pages provides an alternate free hostname; the authoritative room remains
// in the existing Worker. Service binding traffic stays inside Cloudflare.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (
      ['/ws', '/broadcast-relay', '/healthz', '/config'].includes(path) ||
      path.startsWith('/cache-plan/') ||
      path.startsWith('/images/') ||
      path.startsWith('/resolve-source/') ||
      path.startsWith('/media/')
    )
      return env.WATCH.fetch(request);
    return env.ASSETS.fetch(request);
  },
};

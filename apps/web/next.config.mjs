/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are shipped as TypeScript source and transpiled here.
  transpilePackages: ['@re/ui', '@re/config', '@re/validation', '@re/domain'],
  eslint: {
    // ESLint (including the full @next/eslint-plugin-next rule set) runs as a
    // dedicated step via `pnpm lint` and in CI — see eslint.config.mjs and
    // apps/web/eslint.config.mjs. We do NOT run a second, redundant lint pass
    // during `next build`. No Next.js rule is disabled; this only avoids the
    // monorepo flat-config detector false-warning during the build.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

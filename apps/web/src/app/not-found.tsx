import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg-app px-4 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-champagne">404</p>
      <h1 className="mt-2 text-xl font-semibold text-text-primary">Page not found</h1>
      <p className="mt-1 max-w-sm text-sm text-text-secondary">
        The page you’re looking for doesn’t exist or may have moved.
      </p>
      <Link
        href="/dashboard"
        className="mt-5 rounded-md bg-forest px-4 py-2 text-sm font-medium text-white hover:bg-forest-deep"
      >
        Back to dashboard
      </Link>
    </main>
  );
}

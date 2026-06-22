import { EmptyState } from '@/components/ui/states';

export const dynamic = 'force-dynamic';

export default async function ComingSoonPage({
  searchParams,
}: {
  searchParams: Promise<{ feature?: string }>;
}) {
  const { feature } = await searchParams;
  const name = feature ?? 'This area';
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-text-primary">{name}</h1>
      <EmptyState
        title={`${name} is coming in a future phase`}
        hint="The foundation is in place. This module will light up as the build progresses — it is intentionally not a placeholder page."
      />
    </div>
  );
}

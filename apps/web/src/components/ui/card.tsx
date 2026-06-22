import { cn } from '@re/ui';

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-text-primary">{value}</p>
      {hint ? <p className="mt-1 text-xs text-text-secondary">{hint}</p> : null}
    </div>
  );
}

export function Panel({
  title,
  children,
  className,
  id,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn('rounded-lg border border-border bg-surface', className)}>
      {title ? (
        <h2 className="border-b border-border px-4 py-3 text-sm font-semibold text-text-primary">
          {title}
        </h2>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  );
}

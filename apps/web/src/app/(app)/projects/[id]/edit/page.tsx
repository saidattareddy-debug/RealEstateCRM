import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAppContext, ensurePermission } from '@/lib/auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { Panel } from '@/components/ui/card';
import { PermissionDenied } from '@/components/ui/states';
import {
  ProjectFieldsForm,
  AddConfigForm,
  AddAmenityForm,
  AddOfferForm,
  AddFaqForm,
  AddDocumentForm,
  DeleteButton,
} from './edit-forms';
import {
  deleteConfigurationAction,
  deleteAmenityAction,
  deleteOfferAction,
  deleteFaqAction,
  deleteDocumentAction,
} from '../content-actions';

export const dynamic = 'force-dynamic';

export default async function ProjectEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ensurePermission(ctx, 'projects.manage')) return <PermissionDenied />;

  const supabase = await createSupabaseServerClient();
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, developer, category, sale_status, locality, price_min, price_max')
    .eq('id', id)
    .maybeSingle();
  if (!project) notFound();

  const [{ data: configs }, { data: amenities }, { data: offers }, { data: faqs }, { data: docs }] =
    await Promise.all([
      supabase.from('project_configurations').select('id, label, base_price').eq('project_id', id),
      supabase.from('project_amenities').select('id, name').eq('project_id', id),
      supabase.from('project_offers').select('id, title').eq('project_id', id),
      supabase.from('project_faqs').select('id, question').eq('project_id', id).order('sort_order'),
      supabase.from('project_documents').select('id, title, doc_type, url').eq('project_id', id),
    ]);

  const pid = project.id as string;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">Edit · {project.name}</h1>
        <Link href={`/projects/${pid}`} className="text-sm text-forest hover:underline">
          ← Back to project
        </Link>
      </div>

      <Panel title="Project fields">
        <ProjectFieldsForm
          project={{
            id: pid,
            name: project.name as string,
            developer: (project.developer as string | null) ?? null,
            category: project.category as string,
            sale_status: project.sale_status as string,
            locality: (project.locality as string | null) ?? null,
            price_min: (project.price_min as number | null) ?? null,
            price_max: (project.price_max as number | null) ?? null,
          }}
        />
      </Panel>

      <Panel title="Configurations">
        <ItemList
          items={(configs ?? []).map((c) => ({ id: c.id as string, label: c.label as string }))}
          action={deleteConfigurationAction.bind(null, pid)}
        />
        <div className="mt-3">
          <AddConfigForm projectId={pid} />
        </div>
      </Panel>

      <Panel title="Amenities">
        <ItemList
          items={(amenities ?? []).map((a) => ({ id: a.id as string, label: a.name as string }))}
          action={deleteAmenityAction.bind(null, pid)}
        />
        <div className="mt-3">
          <AddAmenityForm projectId={pid} />
        </div>
      </Panel>

      <Panel title="Offers">
        <ItemList
          items={(offers ?? []).map((o) => ({ id: o.id as string, label: o.title as string }))}
          action={deleteOfferAction.bind(null, pid)}
        />
        <div className="mt-3">
          <AddOfferForm projectId={pid} />
        </div>
      </Panel>

      <Panel title="FAQs">
        <ItemList
          items={(faqs ?? []).map((f) => ({ id: f.id as string, label: f.question as string }))}
          action={deleteFaqAction.bind(null, pid)}
        />
        <div className="mt-3">
          <AddFaqForm projectId={pid} />
        </div>
      </Panel>

      <Panel title="Documents & media (by URL)">
        <ItemList
          items={(docs ?? []).map((d) => ({
            id: d.id as string,
            label: `${d.doc_type}: ${d.title}`,
          }))}
          action={deleteDocumentAction.bind(null, pid)}
        />
        <div className="mt-3">
          <AddDocumentForm projectId={pid} />
        </div>
      </Panel>
    </div>
  );
}

function ItemList({
  items,
  action,
}: {
  items: { id: string; label: string }[];
  /** Server action bound to the projectId; DeleteButton calls it with the row id. */
  action: (id: string) => Promise<unknown>;
}) {
  if (items.length === 0) return <p className="text-sm text-text-secondary">None yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((it) => (
        <li
          key={it.id}
          className="flex items-center justify-between border-b border-border/50 py-1 last:border-0"
        >
          <span className="text-text-primary">{it.label}</span>
          <DeleteButton action={action} id={it.id} />
        </li>
      ))}
    </ul>
  );
}

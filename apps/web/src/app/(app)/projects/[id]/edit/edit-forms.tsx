'use client';

import { useActionState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import {
  updateProjectAction,
  addConfigurationAction,
  deleteConfigurationAction,
  addAmenityAction,
  deleteAmenityAction,
  addOfferAction,
  deleteOfferAction,
  addFaqAction,
  deleteFaqAction,
  addDocumentAction,
  deleteDocumentAction,
  type ActionState,
} from '../content-actions';

const initial: ActionState = {};

function Inp(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <label className="flex flex-col text-xs text-text-secondary">
      {label}
      <input
        {...rest}
        className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
      />
    </label>
  );
}

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-forest px-3 py-1.5 text-sm font-medium text-white hover:bg-forest-deep disabled:opacity-60"
    >
      {pending ? '…' : label}
    </button>
  );
}

export function DeleteButton({
  action,
  id,
}: {
  /** A server action bound to the projectId; called with the row id. */
  action: (id: string) => Promise<unknown>;
  id: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label="Delete"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await action(id);
          router.refresh();
        })
      }
      className="rounded-md p-1 text-text-secondary hover:bg-surface-elevated hover:text-terracotta disabled:opacity-60"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

export function ProjectFieldsForm({
  project,
}: {
  project: {
    id: string;
    name: string;
    developer: string | null;
    category: string;
    sale_status: string;
    locality: string | null;
    price_min: number | null;
    price_max: number | null;
  };
}) {
  const [state, action, pending] = useActionState(updateProjectAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="projectId" value={project.id} />
      <Inp label="Name" name="name" defaultValue={project.name} required />
      <Inp label="Developer" name="developer" defaultValue={project.developer ?? ''} />
      <label className="flex flex-col text-xs text-text-secondary">
        Category
        <select
          name="category"
          defaultValue={project.category}
          className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          {['apartment', 'villa', 'plot', 'commercial'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-text-secondary">
        Sale status
        <select
          name="saleStatus"
          defaultValue={project.sale_status}
          className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          {['upcoming', 'active', 'sold_out', 'on_hold'].map((c) => (
            <option key={c} value={c}>
              {c.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <Inp label="Locality" name="locality" defaultValue={project.locality ?? ''} />
      <Inp label="Price min" name="priceMin" type="number" defaultValue={project.price_min ?? ''} />
      <Inp label="Price max" name="priceMax" type="number" defaultValue={project.price_max ?? ''} />
      <Submit pending={pending} label="Save fields" />
      {state.error ? <p className="w-full text-sm text-terracotta">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-sm text-success">Saved.</p> : null}
    </form>
  );
}

export function AddConfigForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(addConfigurationAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Inp label="Label (e.g. 2 BHK)" name="label" required />
      <Inp label="Carpet sqft" name="carpetAreaSqft" type="number" />
      <Inp label="Base price" name="basePrice" type="number" />
      <Submit pending={pending} label="Add config" />
      {state.error ? <p className="w-full text-sm text-terracotta">{state.error}</p> : null}
    </form>
  );
}

export function AddAmenityForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(addAmenityAction, initial);
  return (
    <form action={action} className="flex items-end gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Inp label="Amenity" name="name" required />
      <Submit pending={pending} label="Add" />
      {state.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
    </form>
  );
}

export function AddOfferForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(addOfferAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Inp label="Offer title" name="title" required />
      <Inp label="Details" name="details" />
      <Submit pending={pending} label="Add offer" />
      {state.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
    </form>
  );
}

export function AddFaqForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(addFaqAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Inp label="Question" name="question" required />
      <Inp label="Answer" name="answer" required />
      <Submit pending={pending} label="Add FAQ" />
      {state.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
    </form>
  );
}

export function AddDocumentForm({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState(addDocumentAction, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex flex-col text-xs text-text-secondary">
        Type
        <select
          name="docType"
          defaultValue="brochure"
          className="mt-1 rounded-md border border-border bg-surface-elevated px-2 py-1 text-sm text-text-primary"
        >
          {['brochure', 'price_list', 'payment_plan', 'legal', 'rera', 'other'].map((c) => (
            <option key={c} value={c}>
              {c.replace('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <Inp label="Title" name="title" required />
      <Inp label="URL" name="url" type="url" required />
      <Submit pending={pending} label="Add document" />
      {state.error ? <span className="text-sm text-terracotta">{state.error}</span> : null}
    </form>
  );
}

export const childDeleters = {
  config: deleteConfigurationAction,
  amenity: deleteAmenityAction,
  offer: deleteOfferAction,
  faq: deleteFaqAction,
  document: deleteDocumentAction,
};

'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { writeAudit } from '@/lib/audit/audit-service';

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export interface SignInState {
  error?: string;
}

export async function signInAction(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: 'Enter a valid email and a password of at least 8 characters.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    await writeAudit({
      action: 'SIGN_IN_FAILURE',
      metadata: { email: parsed.data.email }, // never the password
    });
    return { error: 'Invalid credentials. Please try again.' };
  }
  await writeAudit({ action: 'SIGN_IN_SUCCESS', actorUserId: data.user?.id ?? null });
  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  await writeAudit({ action: 'SIGN_OUT', actorUserId: user?.id ?? null });
  redirect('/sign-in');
}

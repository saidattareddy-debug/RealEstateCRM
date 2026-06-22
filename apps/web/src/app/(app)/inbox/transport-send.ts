'use server';

import { sendReplyAction } from './actions';

/**
 * Plain-args send used by the polling transport (the underlying action is
 * FormData-based for the form UI). DNC/consent/permission/status checks all live
 * in `sendReplyAction`.
 */
export async function sendReplyFromTransport(
  conversationId: string,
  body: string,
): Promise<{ ok: boolean; error?: string }> {
  const fd = new FormData();
  fd.set('conversationId', conversationId);
  fd.set('body', body);
  const res = await sendReplyAction({}, fd);
  return { ok: Boolean(res.ok), error: res.error };
}

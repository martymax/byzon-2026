import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { auth } from '@/server/auth';
import { database } from '@/server/database';
import { resolvePostLoginDestination } from '@/server/post-login';

export const dynamic = 'force-dynamic';

export default async function PostLoginPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect('/prihlaseni');

  redirect(await resolvePostLoginDestination(database.db, session.user.id));
}

import { NetworkingProfile } from '@/components/networking-directory';

export default async function NetworkingProfilePage({
  params,
}: {
  params: Promise<{ profileId: string }>;
}) {
  const { profileId } = await params;
  return (
    <section className="app-page">
      <NetworkingProfile profileId={profileId} />
    </section>
  );
}

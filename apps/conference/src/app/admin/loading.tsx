import { AdminPageHeader, AdminSkeleton } from '@byzon/ui';

export default function AdminLoading() {
  return (
    <section>
      <AdminPageHeader
        description="Připravuji bezpečný obsah pro vybranou část administrace."
        title="Načítám administraci"
      />
      <AdminSkeleton />
    </section>
  );
}

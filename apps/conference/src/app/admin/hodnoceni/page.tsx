import type { Metadata } from 'next';
import { AdminFeedbackWorkspace } from '@/components/admin-feedback-workspace';

export const metadata: Metadata = {
  title: { absolute: 'Hodnocení konference | Administrace BYZON' },
};

export default function AdminFeedbackPage() {
  return <AdminFeedbackWorkspace />;
}

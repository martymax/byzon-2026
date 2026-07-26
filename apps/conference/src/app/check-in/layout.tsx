import type { ReactNode } from 'react';

import styles from '../../components/checkin.module.css';

export const dynamic = 'force-dynamic';

export default function CheckinLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className={styles.routeBoundary} data-checkin-route>
      {children}
    </div>
  );
}

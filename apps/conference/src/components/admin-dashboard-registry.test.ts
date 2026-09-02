import { adminOperationsMetricIdSchema } from '@byzon/domain/contracts/admin';
import { adminContextFixtures } from '@byzon/test-support/fixtures';
import { describe, expect, it } from 'vitest';

import {
  adminDashboardMetricOrder,
  adminDashboardMetricRegistry,
} from './admin-dashboard-registry';

describe('admin dashboard metric registry', () => {
  it('covers every contract metric exactly once and in the approved order', () => {
    expect(adminDashboardMetricOrder).toEqual(
      adminOperationsMetricIdSchema.options,
    );
    expect(Object.keys(adminDashboardMetricRegistry).sort()).toEqual(
      [...adminOperationsMetricIdSchema.options].sort(),
    );
  });

  it('does not invent actions for metrics without a permission-safe target', () => {
    expect(adminDashboardMetricRegistry.activation.resolveAction()).toBeNull();
    expect(adminDashboardMetricRegistry.import.resolveAction()).toBeNull();
    expect(
      adminDashboardMetricRegistry.notification.resolveAction(),
    ).toBeNull();
  });

  it('keeps permission and capability gated actions hidden', () => {
    const context = adminContextFixtures.room_operator!;

    expect(
      adminDashboardMetricRegistry.content.resolveAction(context),
    ).toBeNull();
    expect(
      adminDashboardMetricRegistry.checkin.resolveAction(context),
    ).toBeNull();
    expect(
      adminDashboardMetricRegistry.reservation.resolveAction(context),
    ).toBeNull();
  });
});

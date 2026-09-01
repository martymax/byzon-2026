import { adminOperationsMetricIdSchema } from '@byzon/domain/contracts/admin';
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
});

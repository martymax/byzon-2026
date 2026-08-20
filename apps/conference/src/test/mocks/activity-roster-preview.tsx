import { activityRosterFixtures } from '@byzon/test-support/fixtures';

import { ActivityRoster } from '@/components/activity-roster';

export const ActivityRosterPreview = () => (
  <ActivityRoster data={activityRosterFixtures.assigned!} />
);

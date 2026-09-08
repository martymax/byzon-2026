import type { AdminContentItem } from '../lib/admin-content-api';
import type { BulkValues } from './admin-bulk-panel';

export const contentBulkPatch = (
  action: string,
  item: AdminContentItem,
  values: BulkValues,
  index: number,
): Record<string, unknown> => {
  if (action === 'sortOrder')
    return { sortOrder: Number(values.value) + index };
  if (action === 'shiftTime') {
    const offset = Number(values.value) * 60_000;
    return {
      startsAt: new Date(
        Date.parse(String(item.startsAt)) + offset,
      ).toISOString(),
      endsAt: new Date(Date.parse(String(item.endsAt)) + offset).toISOString(),
    };
  }
  if (action === 'addSpeaker' || action === 'removeSpeaker') {
    const ids = Array.isArray(item.speakerIds)
      ? (item.speakerIds as string[])
      : [];
    return {
      speakerIds:
        action === 'addSpeaker'
          ? [...new Set([...ids, values.value])]
          : ids.filter((id) => id !== values.value),
    };
  }
  if (action === 'capacity')
    return { capacity: values.value === '' ? null : Number(values.value) };
  return {
    [action]:
      values.value === '__none__' || values.value === '' ? null : values.value,
  };
};

import { z } from 'zod';

const targetViewportsSchema = z.tuple([
  z.strictObject({
    id: z.literal('phone'),
    label: z.literal('375 × 667'),
    width: z.literal(375),
    height: z.literal(667),
  }),
  z.strictObject({
    id: z.literal('tablet'),
    label: z.literal('768 × 1024'),
    width: z.literal(768),
    height: z.literal(1024),
  }),
  z.strictObject({
    id: z.literal('desktop'),
    label: z.literal('1280 × 800'),
    width: z.literal(1280),
    height: z.literal(800),
  }),
]);

const parsedTargetViewports = targetViewportsSchema.parse([
  { id: 'phone', label: '375 × 667', width: 375, height: 667 },
  { id: 'tablet', label: '768 × 1024', width: 768, height: 1024 },
  { id: 'desktop', label: '1280 × 800', width: 1280, height: 800 },
]);

parsedTargetViewports.forEach(Object.freeze);

export const targetViewports = Object.freeze(parsedTargetViewports);

export type TargetViewport = (typeof targetViewports)[number];

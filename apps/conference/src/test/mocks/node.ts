import type { RequestHandler } from 'msw';
import { setupServer } from 'msw/node';

import { mockHandlers } from './handlers.js';

export const createMockServer = (
  ...featureHandlers: readonly RequestHandler[]
) => setupServer(...mockHandlers, ...featureHandlers);

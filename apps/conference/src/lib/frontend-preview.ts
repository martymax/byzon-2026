export interface FrontendPreviewEnvironment {
  readonly nodeEnv: string | undefined;
  readonly mockMode: string | undefined;
}

export const frontendPreviewAvailable = ({
  mockMode,
  nodeEnv,
}: FrontendPreviewEnvironment): boolean =>
  nodeEnv !== 'production' && mockMode === 'enabled';

export const isFrontendPreviewAvailable = (): boolean =>
  frontendPreviewAvailable({
    nodeEnv: process.env.NODE_ENV,
    mockMode: process.env.NEXT_PUBLIC_BYZON_API_MOCKS,
  });

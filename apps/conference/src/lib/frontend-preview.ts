export interface FrontendPreviewEnvironment {
  readonly nodeEnv: string | undefined;
}

export const frontendPreviewAvailable = ({
  nodeEnv,
}: FrontendPreviewEnvironment): boolean => nodeEnv !== 'production';

export const isFrontendPreviewAvailable = (): boolean =>
  frontendPreviewAvailable({
    nodeEnv: process.env.NODE_ENV,
  });

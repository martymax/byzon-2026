const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PROBLEM_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,127}$/;

export interface ApiProblemErrorInput {
  status: number;
  code: string;
  title: string;
  detail: string;
  fieldErrors?: Record<string, string[]>;
  headers?: Record<string, string>;
}

export class ApiProblemError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly detail: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly headers?: Record<string, string>;

  constructor(input: ApiProblemErrorInput) {
    super(input.title);
    this.name = 'ApiProblemError';
    if (
      !Number.isInteger(input.status) ||
      input.status < 400 ||
      input.status > 599 ||
      !PROBLEM_CODE_PATTERN.test(input.code)
    ) {
      throw new TypeError('Invalid API problem metadata');
    }
    this.status = input.status;
    this.code = input.code;
    this.title = input.title;
    this.detail = input.detail;
    if (input.fieldErrors) this.fieldErrors = input.fieldErrors;
    if (input.headers) this.headers = input.headers;
  }
}

export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  requestId: string;
  fieldErrors?: Record<string, string[]>;
}

export const getRequestId = (
  headers: Headers,
  generateId: () => string = () => crypto.randomUUID(),
): string => {
  const supplied = headers.get('x-request-id');
  return supplied && REQUEST_ID_PATTERN.test(supplied)
    ? supplied
    : generateId();
};

const internalProblem = (): ApiProblemError =>
  new ApiProblemError({
    status: 500,
    code: 'INTERNAL_ERROR',
    title: 'Internal server error',
    detail: 'The request could not be completed.',
  });

export const problemResponse = (
  error: unknown,
  requestId: string,
): Response => {
  const problem = error instanceof ApiProblemError ? error : internalProblem();
  const body: ApiProblem = {
    type: `urn:byzon:problem:${problem.code.toLowerCase().replaceAll('_', '-')}`,
    title: problem.title,
    status: problem.status,
    code: problem.code,
    detail: problem.detail,
    requestId,
    ...(problem.fieldErrors ? { fieldErrors: problem.fieldErrors } : {}),
  };
  return new Response(JSON.stringify(body), {
    status: problem.status,
    headers: {
      ...problem.headers,
      'cache-control': 'no-store',
      'content-type': 'application/problem+json',
      'x-request-id': requestId,
    },
  });
};

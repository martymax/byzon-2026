import type { z } from 'zod';

const FIXTURE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export interface FixtureValidationIssue {
  readonly code: string;
  readonly path: string;
}

export class FixtureValidationError extends Error {
  readonly fixtureName: string;
  readonly issues: readonly FixtureValidationIssue[];

  constructor(fixtureName: string, issues: readonly FixtureValidationIssue[]) {
    super(
      `Fixture "${fixtureName}" failed contract validation at ${issues
        .map((issue) => `${issue.path} (${issue.code})`)
        .join(', ')}`,
    );
    this.name = 'FixtureValidationError';
    this.fixtureName = fixtureName;
    this.issues = Object.freeze(
      issues.map((issue) => Object.freeze({ ...issue })),
    );
  }
}

const assertFixtureName = (fixtureName: string): void => {
  if (!FIXTURE_NAME_PATTERN.test(fixtureName)) {
    throw new TypeError('Invalid fixture name');
  }
};

const issuePath = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? '$' : `$.${path.map(String).join('.')}`;

const jsonSafetyIssue = (path: string): FixtureValidationIssue => ({
  code: 'not_json_safe',
  path,
});

const findJsonSafetyIssue = (
  value: unknown,
  path = '$',
  ancestors = new WeakSet<object>(),
): FixtureValidationIssue | null => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : jsonSafetyIssue(path);
  }
  if (typeof value !== 'object') return jsonSafetyIssue(path);
  if (ancestors.has(value)) return jsonSafetyIssue(path);

  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    return jsonSafetyIssue(path);
  }

  ancestors.add(value);
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value);
  for (const [key, item] of entries) {
    const issue = findJsonSafetyIssue(item, `${path}.${key}`, ancestors);
    if (issue) return issue;
  }
  ancestors.delete(value);
  return null;
};

const cloneJsonFixture = <Value>(value: Value): Value => structuredClone(value);

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
};

export interface ValidateFixtureOptions<Schema extends z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
  readonly value: unknown;
}

export const validateFixture = <Schema extends z.ZodType>({
  name,
  schema,
  value,
}: ValidateFixtureOptions<Schema>): z.output<Schema> => {
  assertFixtureName(name);
  const inputSafetyIssue = findJsonSafetyIssue(value);
  if (inputSafetyIssue) {
    throw new FixtureValidationError(name, [inputSafetyIssue]);
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new FixtureValidationError(
      name,
      result.error.issues.map((issue) => ({
        code: issue.code,
        path: issuePath(issue.path),
      })),
    );
  }

  const outputSafetyIssue = findJsonSafetyIssue(result.data);
  if (outputSafetyIssue) {
    throw new FixtureValidationError(name, [outputSafetyIssue]);
  }
  return deepFreeze(cloneJsonFixture(result.data));
};

export interface FixtureFactory<Schema extends z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
  readonly base: z.output<Schema>;
  create(
    variantName?: string,
    transform?: (base: z.output<Schema>) => z.input<Schema>,
  ): z.output<Schema>;
}

export interface DefineFixtureFactoryOptions<Schema extends z.ZodType> {
  readonly name: string;
  readonly schema: Schema;
  readonly defaults: z.input<Schema>;
}

export const defineFixtureFactory = <Schema extends z.ZodType>({
  name,
  schema,
  defaults,
}: DefineFixtureFactoryOptions<Schema>): FixtureFactory<Schema> => {
  const base = validateFixture({
    name: `${name}.base`,
    schema,
    value: defaults,
  });

  return Object.freeze({
    name,
    schema,
    base,
    create: (
      variantName = 'default',
      transform?: (base: z.output<Schema>) => z.input<Schema>,
    ): z.output<Schema> => {
      assertFixtureName(variantName);
      const clonedBase = cloneJsonFixture(base);
      const input = transform ? transform(clonedBase) : clonedBase;
      return validateFixture({
        name: `${name}.${variantName}`,
        schema,
        value: input,
      });
    },
  });
};

export interface DefineFixtureSetOptions<
  Schema extends z.ZodType,
  Fixtures extends Readonly<Record<string, z.input<Schema>>>,
> {
  readonly name: string;
  readonly schema: Schema;
  readonly fixtures: Fixtures;
}

export const defineFixtureSet = <
  Schema extends z.ZodType,
  const Fixtures extends Readonly<Record<string, z.input<Schema>>>,
>({
  name,
  schema,
  fixtures,
}: DefineFixtureSetOptions<Schema, Fixtures>): Readonly<{
  [Key in keyof Fixtures]: z.output<Schema>;
}> => {
  assertFixtureName(name);
  const entries = Object.entries(fixtures).map(([fixtureName, value]) => {
    assertFixtureName(fixtureName);
    return [
      fixtureName,
      validateFixture({
        name: `${name}.${fixtureName}`,
        schema,
        value,
      }),
    ] as const;
  });

  return Object.freeze(
    Object.fromEntries(entries) as {
      [Key in keyof Fixtures]: z.output<Schema>;
    },
  );
};

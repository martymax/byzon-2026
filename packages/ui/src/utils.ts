export const joinClassNames = (
  ...values: Array<string | false | null | undefined>
) => values.filter(Boolean).join(' ');

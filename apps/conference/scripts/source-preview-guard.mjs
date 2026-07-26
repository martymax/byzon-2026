import ts from 'typescript';

const unwrapParentheses = (node) =>
  ts.isParenthesizedExpression(node)
    ? unwrapParentheses(node.expression)
    : node;

const isNodeEnvironmentEquality = (sourceFile, node, expected) => {
  const expression = unwrapParentheses(node);
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    expression.left.getText(sourceFile) === 'process.env.NODE_ENV' &&
    ts.isStringLiteral(expression.right) &&
    expression.right.text === expected
  );
};

const isPositivePreviewEnvironmentGuard = (sourceFile, node) => {
  const expression = unwrapParentheses(node);
  return (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.BarBarToken &&
    isNodeEnvironmentEquality(sourceFile, expression.left, 'development') &&
    isNodeEnvironmentEquality(sourceFile, expression.right, 'test')
  );
};

export const hasSingleGuardedPreviewImport = (
  source,
  moduleSpecifier,
  previewModuleFragments = [
    moduleSpecifier.split('/').at(-1) ?? moduleSpecifier,
  ],
) => {
  const sourceFile = ts.createSourceFile(
    'preview-boundary.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (sourceFile.parseDiagnostics.length > 0) return false;

  const guards = [];
  const imports = [];
  let unsafeModuleReference = false;
  const isPreviewModule = (candidate) =>
    previewModuleFragments.some((fragment) => candidate.includes(fragment));
  const isExpectedModule = (candidate) =>
    candidate.replace(/\.[cm]?[jt]sx?$/, '') ===
    moduleSpecifier.replace(/\.[cm]?[jt]sx?$/, '');
  const staticModuleSpecifier = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      return node.moduleSpecifier.text;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      return node.moduleReference.expression.text;
    }
    return null;
  };
  const visit = (node) => {
    if (
      ts.isIfStatement(node) &&
      isPositivePreviewEnvironmentGuard(sourceFile, node.expression)
    ) {
      guards.push(node.thenStatement);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      if (
        node.arguments.length === 1 &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        isPreviewModule(node.arguments[0].text)
      ) {
        imports.push({ node, specifier: node.arguments[0].text });
      } else {
        unsafeModuleReference = true;
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require'
    ) {
      unsafeModuleReference = true;
    } else {
      const specifier = staticModuleSpecifier(node);
      if (specifier && isPreviewModule(specifier)) {
        unsafeModuleReference = true;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  if (
    guards.length !== 1 ||
    imports.length !== 1 ||
    unsafeModuleReference ||
    !isExpectedModule(imports[0].specifier)
  ) {
    return false;
  }
  const [guard] = guards;
  const [{ node: previewImport }] = imports;
  return (
    previewImport.getStart(sourceFile) >= guard.getStart(sourceFile) &&
    previewImport.end <= guard.end
  );
};

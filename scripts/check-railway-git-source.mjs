// Production is deployed exclusively by the GitHub integration from main.
// Refuse CLI uploads before they can replace a newer production release.
const productionEnvironment = '35c2e399-920a-42c1-84ef-0aede59bf52b';
if (
  process.env.RAILWAY_ENVIRONMENT_ID === productionEnvironment &&
  (process.env.RAILWAY_GIT_BRANCH !== 'main' ||
    !/^[a-f0-9]{40}$/i.test(process.env.RAILWAY_GIT_COMMIT_SHA ?? ''))
) {
  console.error(
    'Production requires a GitHub deployment from main with a commit SHA. Push the reviewed commit to main; do not use railway up.',
  );
  process.exit(1);
}

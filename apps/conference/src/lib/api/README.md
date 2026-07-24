# Typed browser API port

`lib/api` is the conference browser boundary for JSON endpoints under
same-origin `/api/v1`. Feature slices define exact request, success and
`application/problem+json` schemas with `defineApiEndpoint`; UI code depends on
the exported `ApiPort`, not on server or database modules.

## Guarantees

- Every request body and every successful or problem response is runtime
  validated. Unknown problem codes, mismatched status/request IDs, invalid
  content types and malformed metadata become `invalid_response`.
- Fetch, response-body, offline, timeout and caller-abort failures use a
  transport-neutral taxonomy and never expose raw exceptions or response
  bodies.
- Caller configuration errors throw `ApiRequestConfigurationError` containing
  only stable codes and schema paths. Rejected values are not copied into the
  error.
- Paths remain under same-origin `/api/v1`; credentials use `same-origin` and
  redirects are rejected. Request and response bodies are bounded.
- Automatic retry is allowed only for endpoints declared as safe reads, at
  most twice and with bounded backoff/`Retry-After`. Mutations are never
  retried automatically, even with an idempotency key.
- Endpoint policy explicitly declares whether idempotency is forbidden,
  optional or required. ETag revalidation accepts `304` only when the returned
  ETag matches the requested one.

Mocks in `F0-05` must implement the same `ApiPort`; neither mocks nor
`@byzon/test-support` may enter this production module graph. Existing
feature-specific raw `fetch` calls are migrated only with their owning
contract slice so this foundation does not invent or duplicate feature DTOs.

/**
 * Always hit the same-origin Next rewrite so the HttpOnly guest cookie
 * stays first-party. Cross-origin NEXT_PUBLIC_API_URL breaks the trial.
 * Point PYTHON_API_URL at the FastAPI backend for the rewrite target.
 */
export function getApiUrl(): string {
  return "/api/python";
}

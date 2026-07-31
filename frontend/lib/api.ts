/**
 * Same-origin API path. On Vercel Services, /api/python is routed to FastAPI.
 * Locally, next.config rewrites it to uvicorn (PYTHON_API_URL).
 */
export function getApiUrl(): string {
  return "/api/python";
}

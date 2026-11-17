export const MAPBOX_TOKEN = 'pk.eyJ1IjoianVsaW9jZXNhcmxvcGV6YW1kb3IiLCJhIjoiY213YjVxcXNjMDA2czMwb2NpZTMwcDU3cSJ9.PQmJ73qmNNfrAxLN8X6tRw';

/** API de EnRuta (Node.js + PostgreSQL). Ajusta la URL si despliegas el backend en otro host. */
const codespacesApiUrl = resolveCodespacesApiUrl();

/** En Codespaces la web usa el proxy de Angular; el QR necesita la URL alcanzable desde el móvil. */
export const API_URL = codespacesApiUrl ? '' : resolveLocalApiUrl();
export const MOBILE_API_URL = codespacesApiUrl ?? API_URL;

function resolveCodespacesApiUrl(): string | null {
  if (typeof location === 'undefined') return null;
  const codespaces = location.hostname.match(/^(.*)-\d+\.app\.github\.dev$/);
  return codespaces ? `https://${codespaces[1]}-3000.app.github.dev` : null;
}

function resolveLocalApiUrl(): string {
  if (typeof location === 'undefined') return 'http://localhost:3000';
  const host = location.hostname;
  return `http://${host}:3000`;
}
export const API_KEY = 'dev-admin-key';

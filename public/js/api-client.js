export async function readHealth() {
  const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`Health request failed: ${response.status}`);
  return response.json();
}

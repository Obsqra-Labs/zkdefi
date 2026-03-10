export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:8003';

function forwardHeaders(req: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const wallet = req.headers.get('x-wallet-address');
  if (wallet) h['X-Wallet-Address'] = wallet;
  const auth = req.headers.get('authorization');
  if (auth) h['Authorization'] = auth;
  return h;
}

export async function GET(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const qs = new URL(req.url).search || '';
  const backendUrl = `${BACKEND_URL}/api/v1/${path}${qs}`;

  try {
    const response = await fetch(backendUrl, { method: 'GET', headers: forwardHeaders(req) });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: 'Backend error', details: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const qs = new URL(req.url).search || '';
  const backendUrl = `${BACKEND_URL}/api/v1/${path}${qs}`;
  const body = await req.text();

  try {
    const response = await fetch(backendUrl, { method: 'POST', headers: forwardHeaders(req), body });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: 'Backend error', details: String(error) }, { status: 500 });
  }
}

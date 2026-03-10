export const dynamic = 'force-dynamic';

// Always proxy to local FastAPI — NEXT_PUBLIC_API_URL is the public hostname and must NOT be used here
const BACKEND_URL = process.env.BACKEND_API_URL || 'http://localhost:8003';

/** Forward auth-relevant headers from the incoming request */
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
  const backendUrl = `${BACKEND_URL}/${path}${qs}`;

  try {
    const response = await fetch(backendUrl, { method: 'GET', headers: forwardHeaders(req) });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: 'Failed to fetch from backend', details: String(error) }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const qs = new URL(req.url).search || '';
  const backendUrl = `${BACKEND_URL}/${path}${qs}`;
  const body = await req.text();

  try {
    const response = await fetch(backendUrl, { method: 'POST', headers: forwardHeaders(req), body });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: 'Failed to fetch from backend', details: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const qs = new URL(req.url).search || '';
  const backendUrl = `${BACKEND_URL}/${path}${qs}`;
  const body = await req.text();

  try {
    const response = await fetch(backendUrl, { method: 'PUT', headers: forwardHeaders(req), body });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: 'Failed to fetch from backend', details: String(error) }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const qs = new URL(req.url).search || '';
  const backendUrl = `${BACKEND_URL}/${path}${qs}`;

  try {
    const response = await fetch(backendUrl, { method: 'DELETE', headers: forwardHeaders(req) });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: 'Failed to fetch from backend', details: String(error) }, { status: 500 });
  }
}

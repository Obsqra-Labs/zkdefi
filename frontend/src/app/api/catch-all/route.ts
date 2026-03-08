export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_API_URL || 'http://127.0.0.1:8003';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/catch-all/, '');
  const queryString = url.search;
  
  const backendUrl = `${BACKEND_URL}${path}${queryString}`;
  
  try {
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: 'Backend request failed', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/catch-all/, '');
  const queryString = url.search;
  
  const backendUrl = `${BACKEND_URL}${path}${queryString}`;
  const body = await req.text();
  
  try {
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
    });
    
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: 'Backend request failed', details: String(error) },
      { status: 500 }
    );
  }
}

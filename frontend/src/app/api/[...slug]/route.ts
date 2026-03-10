export const dynamic = 'force-dynamic';

const BACKEND_URL = process.env.BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL?.replace(/^\/api.*/, 'http://localhost:8003') || 'http://localhost:8003';

export async function GET(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const url = new URL(req.url);
  const queryString = url.search ? `?${url.searchParams}` : '';
  
  const backendUrl = `${BACKEND_URL}/${path}${queryString}`;
  
  try {
    const response = await fetch(backendUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: 'Failed to fetch from backend', details: String(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const url = new URL(req.url);
  const queryString = url.search ? `?${url.searchParams}` : '';
  
  const backendUrl = `${BACKEND_URL}/${path}${queryString}`;
  const body = await req.text();
  
  try {
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body,
    });
    
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: 'Failed to fetch from backend', details: String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const url = new URL(req.url);
  const queryString = url.search ? `?${url.searchParams}` : '';
  
  const backendUrl = `${BACKEND_URL}/${path}${queryString}`;
  const body = await req.text();
  
  try {
    const response = await fetch(backendUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: body,
    });
    
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: 'Failed to fetch from backend', details: String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request, { params }: { params: { slug: string[] } }) {
  const path = params.slug.join('/');
  const url = new URL(req.url);
  const queryString = url.search ? `?${url.searchParams}` : '';
  
  const backendUrl = `${BACKEND_URL}/${path}${queryString}`;
  
  try {
    const response = await fetch(backendUrl, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json(
      { error: 'Failed to fetch from backend', details: String(error) },
      { status: 500 }
    );
  }
}

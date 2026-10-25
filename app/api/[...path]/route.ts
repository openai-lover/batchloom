import { env } from 'cloudflare:workers';
import { handleApi } from '@/lib/http';
import type { HttpEnvironment } from '@/lib/http';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) { return handleApi(request, env as unknown as HttpEnvironment); }
export async function POST(request: Request) { return handleApi(request, env as unknown as HttpEnvironment); }

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const publicPaths = ['/login', '/signup', '/', '/auth/callback'];

// List of paths that should bypass the middleware
const bypassPaths = [
  '/_next/static',
  '/_next/image',
  '/favicon.ico',
  '/api/auth/',
  '/auth/callback',
  '/api/integrations/',
  '/api/auth/callback',
];

// Dynamically import mcpManager to avoid issues in middleware
async function preloadMCPData(userId: string) {
  try {
    const { mcpManager } = await import('@/lib/mcp-manager');
    mcpManager.preloadUserData(userId).catch(error => {
      console.error('❌ Failed to preload MCP data in middleware:', error);
    });
  } catch (error) {
    console.error('❌ Failed to import MCP manager in middleware:', error);
  }
}

export async function middleware(request: NextRequest) {
  // Skip middleware for static files and API routes
  if (bypassPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    return NextResponse.next();
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  try {
    // Create a Supabase client configured to use cookies
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return request.cookies.get(name)?.value;
          },
          set(name: string, value: string, options: any) {
            request.cookies.set({
              name,
              value,
              ...options,
            });
            response = NextResponse.next({
              request: {
                headers: request.headers,
              },
            });
            response.cookies.set({
              name,
              value,
              ...options,
              httpOnly: true,
              secure: process.env.NODE_ENV === 'production',
              sameSite: 'lax',
              path: '/',
            });
          },
          remove(name: string, options: any) {
            request.cookies.set({
              name,
              value: '',
              ...options,
            });
            response = NextResponse.next({
              request: {
                headers: request.headers,
              },
            });
            response.cookies.set({
              name,
              value: '',
              ...options,
              maxAge: 0,
              expires: new Date(0),
              path: '/',
            });
          },
        },
      }
    );

    // Get the session
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error) {
      console.error('Error getting session:', error);
    }

    const { pathname } = request.nextUrl;

    // If user is not signed in and the current path is not public, redirect to login
    if (!session && !publicPaths.some(path => pathname.startsWith(path))) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('redirectedFrom', pathname);
      return NextResponse.redirect(redirectUrl);
    }

    // Preload MCP data when user accesses dashboard (in background)
    if (session?.user?.id && pathname.startsWith('/dashboard')) {
      console.log('🔄 Preloading MCP data for dashboard access:', session.user.id);
      preloadMCPData(session.user.id);
    }

    // In development, allow access to login page even when authenticated
    // In production, redirect authenticated users away from auth pages
    if (process.env.NODE_ENV === 'production' && session && (pathname === '/login' || pathname === '/signup' || pathname === '/')) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }

    return response;
  } catch (e) {
    console.error('Middleware error:', e);
    // If there's an error, just continue with the response
    return response;
  }
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api/auth (auth endpoints)
     * - api/integrations (integration endpoints)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|api/auth|api/integrations|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

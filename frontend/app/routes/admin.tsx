import { Link, Outlet, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { backendFetch } from '../lib/backend';

type LoaderData = {
  ok: boolean;
  userCount: number;
  error?: {
    status: number;
    code?: string;
    message: string;
  };
};

const API_ROOT = '/api/v1';

const readJson = async (response: Response) => {
  const contentType = String(response.headers.get('content-type') || '');
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => '');
};

export async function loader({ request, context }: LoaderFunctionArgs): Promise<LoaderData> {
  try {
    const response = await backendFetch(`${API_ROOT}/admin/users?limit=1`, {
      env: (context as any)?.cloudflare?.env,
      request,
      headers: {
        accept: 'application/json',
      },
    });
    const body = await readJson(response);

    if (!response.ok) {
      return {
        ok: false,
        userCount: 0,
        error: {
          status: response.status,
          code: body && typeof body === 'object' ? String((body as any)?.error?.code || '') : undefined,
          message: body && typeof body === 'object'
            ? String((body as any)?.error?.message || (body as any)?.message || response.statusText || 'Admin access denied.')
            : String(body || response.statusText || 'Admin access denied.'),
        },
      };
    }

    const userCount = Array.isArray((body as any)?.items) ? (body as any).items.length : 0;
    return {
      ok: true,
      userCount,
    };
  } catch (error) {
    return {
      ok: false,
      userCount: 0,
      error: {
        status: 503,
        message: error instanceof Error ? error.message : 'Admin backend unavailable.',
      },
    };
  }
}

export default function AdminRoute() {
  const data = useLoaderData() as LoaderData;

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <header style={heroStyle}>
          <div>
            <p style={eyebrowStyle}>Admin</p>
            <h1 style={titleStyle}>Operational controls</h1>
            <p style={subtitleStyle}>
              This route remains session-gated by the backend. It only reflects the live auth outcome and exposes the
              admin sections that already exist.
            </p>
          </div>
          <div style={statStyle}>
            <div style={statLabelStyle}>Users visible</div>
            <div style={statValueStyle}>{data.ok ? data.userCount : '-'}</div>
          </div>
        </header>

        {!data.ok ? (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>Admin access blocked</h2>
            <p style={bodyStyle}>{data.error?.message || 'A valid admin session is required.'}</p>
            <p style={bodySubtleStyle}>Status {data.error?.status || 401}{data.error?.code ? `, code ${data.error.code}` : ''}</p>
            <div style={actionsRowStyle}>
              <Link to="/app/login?mode=login&next=%2Fapp%2Fadmin" style={primaryButtonStyle}>
                Sign in
              </Link>
              <Link to="/app/library" style={secondaryButtonStyle}>
                Back to library
              </Link>
            </div>
          </section>
        ) : (
          <section style={panelStyle}>
            <div style={sectionHeaderStyle}>
              <div>
                <h2 style={sectionTitleStyle}>Admin areas</h2>
                <p style={bodyStyle}>Keep the current gate honest. Use the live endpoints, no shadow auth layer.</p>
              </div>
              <Link to="/app/admin/users" style={primaryButtonStyle}>
                Open users
              </Link>
            </div>

            <div style={cardGridStyle}>
              <article style={cardStyle}>
                <p style={cardKickerStyle}>Users</p>
                <h3 style={cardTitleStyle}>User registry</h3>
                <p style={cardBodyStyle}>
                  Lists live admin users from <code>/api/v1/admin/users</code> and keeps the current backend session
                  gate intact.
                </p>
              </article>
            </div>
          </section>
        )}

        {data.ok ? <Outlet /> : null}
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100dvh',
  padding: '32px 20px',
  background: 'linear-gradient(180deg, #050816 0%, #0a1024 100%)',
  color: '#f5f7ff',
};

const shellStyle: React.CSSProperties = {
  maxWidth: 1120,
  margin: '0 auto',
  display: 'grid',
  gap: 20,
};

const heroStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: 20,
  alignItems: 'end',
  padding: 24,
  borderRadius: 24,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(11, 16, 33, 0.78)',
  boxShadow: '0 24px 80px rgba(0,0,0,0.28)',
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
  fontSize: 12,
  color: '#7dd3fc',
  fontWeight: 700,
};

const titleStyle: React.CSSProperties = {
  margin: '10px 0 8px',
  fontSize: 'clamp(2rem, 4vw, 3.2rem)',
  lineHeight: 1.02,
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  maxWidth: 680,
  color: 'rgba(226,232,240,0.78)',
  lineHeight: 1.6,
};

const statStyle: React.CSSProperties = {
  flex: '1 1 132px',
  maxWidth: 180,
  minWidth: 0,
  padding: '18px 20px',
  borderRadius: 20,
  background: 'linear-gradient(180deg, rgba(34,197,94,0.14), rgba(34,197,94,0.06))',
  border: '1px solid rgba(134,239,172,0.16)',
};

const statLabelStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'rgba(187,247,208,0.78)',
};

const statValueStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 34,
  fontWeight: 800,
};

const panelStyle: React.CSSProperties = {
  padding: 24,
  borderRadius: 24,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(11, 16, 33, 0.72)',
};

const sectionTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 22,
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  color: 'rgba(226,232,240,0.82)',
  lineHeight: 1.65,
};

const bodySubtleStyle: React.CSSProperties = {
  margin: '12px 0 0',
  color: 'rgba(148,163,184,0.9)',
  fontSize: 13,
};

const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  marginTop: 18,
};

const primaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 42,
  padding: '0 14px',
  borderRadius: 999,
  background: 'linear-gradient(90deg, #22d3ee 0%, #4f7cff 100%)',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 700,
};

const secondaryButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 42,
  padding: '0 14px',
  borderRadius: 999,
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#e2e8f0',
  textDecoration: 'none',
  fontWeight: 700,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'center',
  marginBottom: 18,
};

const cardGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
};

const cardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 18,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(8, 12, 26, 0.86)',
};

const cardKickerStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#93c5fd',
  fontWeight: 700,
};

const cardTitleStyle: React.CSSProperties = {
  margin: '8px 0 0',
  fontSize: 18,
};

const cardBodyStyle: React.CSSProperties = {
  margin: '10px 0 0',
  color: 'rgba(226,232,240,0.82)',
  lineHeight: 1.6,
};

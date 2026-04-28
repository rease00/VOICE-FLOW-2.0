import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData } from 'react-router';
import { backendFetch } from '../lib/backend';

type AdminUser = {
  userId: string;
  email?: string;
  displayName?: string;
  fullName?: string;
  role?: string;
  roles?: string[];
  enabled?: boolean;
  updatedAt?: number;
};

type LoaderData = {
  ok: boolean;
  items: AdminUser[];
  count: number;
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
    const backendEnv = (context as any)?.cloudflare?.env;
    const response = await backendFetch(`${API_ROOT}/admin/users?limit=200`, {
      env: backendEnv,
      request,
      headers: {
        accept: 'application/json',
      },
    });
    const body = await readJson(response);

    if (!response.ok) {
      return {
        ok: false,
        items: [],
        count: 0,
        error: {
          status: response.status,
          code: body && typeof body === 'object' ? String((body as any)?.error?.code || '') : undefined,
          message: body && typeof body === 'object'
            ? String((body as any)?.error?.message || (body as any)?.message || response.statusText || 'Unable to load admin users.')
            : String(body || response.statusText || 'Unable to load admin users.'),
        },
      };
    }

    const items = Array.isArray((body as any)?.items) ? (body as any).items : [];
    return {
      ok: true,
      items,
      count: typeof (body as any)?.count === 'number' ? (body as any).count : items.length,
    };
  } catch (error) {
    return {
      ok: false,
      items: [],
      count: 0,
      error: {
        status: 503,
        message: error instanceof Error ? error.message : 'Admin backend unavailable.',
      },
    };
  }
}

export default function AdminUsersRoute() {
  const data = useLoaderData() as LoaderData;

  return (
    <main style={pageStyle}>
      <section style={shellStyle}>
        <header style={heroStyle}>
          <div>
            <p style={eyebrowStyle}>Admin / Users</p>
            <h1 style={titleStyle}>User registry</h1>
            <p style={subtitleStyle}>
              This list is driven by the live admin contract and stays behind the real backend session gate.
            </p>
          </div>
          <Link to="/app/admin" style={backButtonStyle}>
            Back to admin
          </Link>
        </header>

        {!data.ok ? (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>Admin users unavailable</h2>
            <p style={bodyStyle}>{data.error?.message || 'A valid admin session is required.'}</p>
            <p style={bodySubtleStyle}>Status {data.error?.status || 401}{data.error?.code ? `, code ${data.error.code}` : ''}</p>
          </section>
        ) : data.items.length === 0 ? (
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>No admin users found</h2>
            <p style={bodyStyle}>
              The backend returned an empty registry. This page intentionally does not invent creation flows.
            </p>
          </section>
        ) : (
          <section style={listStyle}>
            {data.items.map((user) => (
              <article key={user.userId} style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div>
                    <p style={cardKickerStyle}>User</p>
                    <h2 style={cardTitleStyle}>{user.displayName || user.fullName || user.userId}</h2>
                  </div>
                  <span style={statusPillStyle}>{user.enabled === false ? 'Disabled' : 'Enabled'}</span>
                </div>

                <dl style={metaGridStyle}>
                  <div>
                    <dt style={metaLabelStyle}>User ID</dt>
                    <dd style={metaValueStyle}>{user.userId}</dd>
                  </div>
                  <div>
                    <dt style={metaLabelStyle}>Email</dt>
                    <dd style={metaValueStyle}>{user.email || '-'}</dd>
                  </div>
                  <div>
                    <dt style={metaLabelStyle}>Role</dt>
                    <dd style={metaValueStyle}>{user.role || user.roles?.join(', ') || 'user'}</dd>
                  </div>
                  <div>
                    <dt style={metaLabelStyle}>Updated</dt>
                    <dd style={metaValueStyle}>{formatDate(user.updatedAt)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </section>
        )}
      </section>
    </main>
  );
}

const formatDate = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unknown';
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  } catch {
    return new Date(value).toISOString();
  }
};

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
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

const backButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 42,
  padding: '0 14px',
  borderRadius: 999,
  border: '1px solid rgba(125,211,252,0.18)',
  background: 'rgba(56,189,248,0.12)',
  color: '#dff6ff',
  textDecoration: 'none',
  fontWeight: 700,
  whiteSpace: 'nowrap',
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

const listStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
};

const cardStyle: React.CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 20,
  borderRadius: 22,
  border: '1px solid rgba(255,255,255,0.08)',
  background: 'rgba(8, 12, 26, 0.86)',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'start',
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
  lineHeight: 1.2,
};

const statusPillStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 999,
  background: 'rgba(34,197,94,0.12)',
  color: '#86efac',
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const metaGridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  margin: 0,
};

const metaLabelStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: 'rgba(148,163,184,0.8)',
};

const metaValueStyle: React.CSSProperties = {
  margin: '4px 0 0',
  color: '#e2e8f0',
  fontSize: 13,
  lineHeight: 1.45,
  wordBreak: 'break-word',
};

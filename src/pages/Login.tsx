/**
 * PLACEHOLDER — overwritten by the Phase 5 auth graft.
 * Kept intentionally plain: no useAuth, no const.ts, no AuthLayout.
 */
export default function Login() {
  return (
    <div
      className="flex min-h-[100dvh] items-center justify-center bg-ink-base px-4"
      style={{
        backgroundImage: "url(/auth-topo.png)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="w-full max-w-[420px] rounded-[10px] border border-ink-subtle bg-ink-elevated/95 p-8 text-center shadow-overlay">
        <img src="/logo-mark.svg" alt="" className="mx-auto h-14 w-14" />
        <h1 className="mt-4 text-2xl font-semibold text-ink-primary">Login</h1>
        <p className="mt-1 text-[13px] text-ink-muted">
          Kaduna State deployment · SSO entry arrives with the auth graft.
        </p>
      </div>
    </div>
  );
}

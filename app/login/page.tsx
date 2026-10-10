export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
      }}
    >
      <div className="card" style={{ width: 340 }}>
        <h1 style={{ marginBottom: 24, fontSize: 20, fontWeight: 700 }}>
          TikTok Studio
        </h1>
        {searchParams.error && (
          <p style={{ color: "var(--accent)", marginBottom: 16, fontSize: 13 }}>
            Wrong password.
          </p>
        )}
        <form action="/api/login" method="POST" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            type="password"
            name="password"
            placeholder="Password"
            autoFocus
            required
          />
          <button className="primary" type="submit">
            Enter
          </button>
        </form>
      </div>
    </div>
  );
}

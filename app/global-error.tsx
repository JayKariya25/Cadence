"use client";

/**
 * The last resort: an error in the root layout itself.
 *
 * Next replaces the entire document when this renders, which is why it has to
 * ship its own <html> and <body> and cannot use any of the app's styling —
 * `globals.css` is loaded by the layout that just failed. Everything here is
 * inline for that reason, not for want of a stylesheet.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0b",
          color: "#e9e7ef",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "2rem",
        }}
      >
        <main style={{ maxWidth: "32rem" }}>
          <span
            aria-hidden
            style={{
              display: "block",
              width: "0.375rem",
              height: "2rem",
              borderRadius: "999px",
              background: "#ff3d9a",
            }}
          />
          <h1 style={{ fontSize: "1.75rem", margin: "1.25rem 0 0" }}>
            Cadence could not start.
          </h1>
          <p style={{ color: "#a6a2b2", lineHeight: 1.6, marginTop: "0.75rem" }}>
            The application shell itself failed. Reloading usually resolves it;
            if it does not, check that MongoDB is running — the layout reads the
            session on every request.
          </p>
          {error.digest && (
            <p style={{ color: "#6b6878", fontSize: "0.8rem", marginTop: "0.75rem" }}>
              reference {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "1.75rem",
              padding: "0.6rem 1.1rem",
              borderRadius: "0.5rem",
              border: "none",
              background: "#ff3d9a",
              color: "#0a0a0b",
              fontSize: "0.9rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}

import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/globals.css";

type StartupErrorState = {
  message: string;
  stack?: string;
};

class RootErrorBoundary extends React.Component<
  React.PropsWithChildren,
  { error: StartupErrorState | null }
> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { error: normalizeStartupError(error) };
  }

  componentDidCatch(error: unknown) {
    reportStartupError(error);
  }

  render() {
    if (this.state.error) {
      return <StartupFallback error={this.state.error} />;
    }

    return this.props.children;
  }
}

function StartupFallback({ error }: { error: StartupErrorState }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0f1117",
        color: "#eef2f8",
        padding: "24px",
      }}
    >
      <section
        style={{
          width: "min(720px, 100%)",
          border: "1px solid rgba(248, 113, 113, 0.25)",
          background: "rgba(127, 29, 29, 0.18)",
          borderRadius: "18px",
          padding: "24px",
          boxShadow: "0 24px 80px rgba(0,0,0,0.35)",
        }}
      >
        <p style={{ margin: 0, fontSize: "12px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fca5a5" }}>
          Startup error
        </p>
        <h1 style={{ margin: "12px 0 0", fontSize: "28px", lineHeight: 1.2 }}>
          The app could not finish rendering.
        </h1>
        <p style={{ margin: "12px 0 0", color: "#cbd5e1", lineHeight: 1.6 }}>
          Liga caught a startup exception instead of showing a blank screen.
        </p>
        <pre
          style={{
            marginTop: "18px",
            maxHeight: "320px",
            overflow: "auto",
            borderRadius: "14px",
            padding: "16px",
            background: "#020617",
            color: "#e2e8f0",
            fontSize: "12px",
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ""}
        </pre>
      </section>
    </main>
  );
}

function normalizeStartupError(error: unknown): StartupErrorState {
  if (error instanceof Error) {
    return {
      message: error.message || "Unknown error",
      stack: error.stack,
    };
  }

  if (typeof error === "string") {
    return { message: error };
  }

  return { message: JSON.stringify(error) };
}

function reportStartupError(error: unknown) {
  const normalized = normalizeStartupError(error);
  try {
    localStorage.setItem("liga.startup-error", JSON.stringify(normalized));
  } catch {
    // Ignore storage issues in startup fallback reporting.
  }
}

window.addEventListener("error", (event) => {
  reportStartupError(event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  reportStartupError(event.reason);
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

const root = ReactDOM.createRoot(rootElement);

async function bootstrap() {
  try {
    const { App } = await import("./app/App");
    root.render(
      <React.StrictMode>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </React.StrictMode>,
    );
  } catch (error) {
    reportStartupError(error);
    root.render(<StartupFallback error={normalizeStartupError(error)} />);
  }
}

void bootstrap();

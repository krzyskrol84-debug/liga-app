import type { ReactNode } from "react";

type StatusPanelProps = {
  icon: ReactNode;
  title: string;
  value: string;
  description: string;
};

export function StatusPanel({ icon, title, value, description }: StatusPanelProps) {
  return (
    <article className="status-panel">
      <div className="panel-header">
        <span className="panel-icon">{icon}</span>
        <h2>{title}</h2>
      </div>
      <strong>{value}</strong>
      <p>{description}</p>
    </article>
  );
}

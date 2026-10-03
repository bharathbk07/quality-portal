"use client";
import { ConnectionSettings } from "../../connections/connection-settings";
import type { Workspace } from ".././hooks/use-workspace";
import { Heading } from "./heading";
export function Settings({ w }: { w: Workspace }) {
  return (
    <>
      <Heading
        eyebrow="WORKSPACE SETTINGS"
        title="Connections & intelligence"
        desc="Configure your existing tools and AI providers. Credentials stay encrypted in your workspace."
      />
      {w.isAdmin ? (
        <div className="detail-grid">
          <ConnectionSettings w={w} />
          <div className="stack">
            <section className="panel">
              <h2>Workspace administration</h2>
              <p className="muted">
                Manage workspace membership, role assignments and enterprise
                identity.
              </p>
              <a href="/admin" className="primary">
                Open administration
              </a>
            </section>
            <section className="panel">
              <h2>Connected, on your terms</h2>
              <p className="muted">
                AI is optional. Generation sends your selected scope to the
                chosen provider. Test execution remains in your existing tools.
              </p>
            </section>
          </div>
        </div>
      ) : (
        <div className="notice">
          Your workspace administrator manages connections. You can review your{" "}
          <a href="/account">account settings</a>.
        </div>
      )}
    </>
  );
}

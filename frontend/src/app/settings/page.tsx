"use client";
import { Settings, useWorkspace } from "../../features/workspace/workspace";
import { PageShell } from "../../features/auth/identity-ui";
export default function SettingsPage() {
  const w = useWorkspace();
  return (
    <PageShell w={w}>
      <Settings w={w} />
    </PageShell>
  );
}

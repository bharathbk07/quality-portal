"use client";
import { useState } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Workspace } from ".././hooks/use-workspace";
export function ImportDialog({ w }: { w: Workspace }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  async function submit() {
    try {
      await w.loadSpec(text);
      setError("");
      w.setImportOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog open={w.importOpen} onOpenChange={w.setImportOpen}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>Import an OpenAPI contract</DialogTitle>
        <DialogDescription>
          OpenAPI 3.x · JSON or YAML · up to 1 MB. Stored in the active
          workspace.
        </DialogDescription>
        <label className="secondary">
          <Upload size={16} /> Choose file
          <input
            type="file"
            accept=".json,.yaml,.yml"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > (w.config?.contract_max_bytes ?? 0)) {
                  setError("File exceeds the configured size limit.");
                  return;
                }
                setText(await f.text());
                setError("");
              }
            }}
          />
        </label>
        <label htmlFor="spec" className="field-label">
          Or paste your specification
        </label>
        <textarea
          id="spec"
          className="field"
          rows={12}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            "openapi: 3.0.3\ninfo:\n  title: My API\n  version: 1.0.0\npaths: ..."
          }
        />
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="row">
          <button
            className="primary"
            disabled={!w.canEdit || !text.trim()}
            onClick={submit}
          >
            Import contract
          </button>
          <button
            className="secondary"
            onClick={() => {
              setText(w.exampleSpec);
              setError("");
            }}
          >
            Use example contract
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

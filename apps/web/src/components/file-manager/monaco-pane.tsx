"use client";

import dynamic from "next/dynamic";
import { getLanguage } from "@/components/file-manager/utils";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

export function MonacoPane({
  path,
  content,
  readOnly,
  onChange,
}: {
  path: string;
  content: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="h-full min-h-0 flex-1">
      <MonacoEditor
      height="100%"
      language={getLanguage(path)}
      value={content}
      theme="vs-dark"
      onChange={(v) => onChange?.(v ?? "")}
      options={{
        readOnly,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: 'var(--font-mono), "JetBrains Mono", monospace',
        automaticLayout: true,
        wordWrap: "on",
      }}
    />
    </div>
  );
}

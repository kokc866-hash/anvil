import { useMemo, useState } from "react";
import { FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { unzipFiles } from "@/lib/archive";
import { REF_DIR, readDroppedFile, refIndex, uniqueRefPath, copyIntoRef, isSecretPath } from "@/lib/ref";
import { confirmApp } from "@/lib/confirm";
import { useIde } from "@/store/ide";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { getDrag, hasOsFiles } from "@/lib/dnd";
import { CtxMenu } from "./ctx-menu";

export function RefPane() {
  const files = useIde((s) => s.files);
  const openFile = useIde((s) => s.openFile);
  const writeFile = useIde((s) => s.writeFile);
  const deleteFile = useIde((s) => s.deleteFile);
  const createFolder = useIde((s) => s.createFolder);
  const setNotice = useIde((s) => s.setNotice);
  const [over, setOver] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const rows = useMemo(() => refIndex(files), [files]);

  async function ingest(list: File[]) {
    createFolder(REF_DIR);
    let n = 0;
    for (const file of list) {
      if (file.name.endsWith(".zip")) {
        const pack = await unzipFiles(await file.arrayBuffer());
        for (const [path, content] of Object.entries(pack)) {
          const rel = path.replace(/^\/+/, "");
          if (isSecretPath(rel) || isSecretPath(`${REF_DIR}/${rel}`)) continue;
          writeFile(uniqueRefPath(useIde.getState().files, rel), content);
          n += 1;
        }
        continue;
      }
      const got = await readDroppedFile(file);
      if (!got) {
        setNotice(`Übersprungen: ${file.name}`);
        continue;
      }
      if (isSecretPath(got.name) || isSecretPath(`${REF_DIR}/${got.name}`)) {
        setNotice(`Geheimnis übersprungen: ${file.name}`);
        continue;
      }
      writeFile(uniqueRefPath(useIde.getState().files, got.name), got.content);
      n += 1;
    }
    if (n) setNotice(`${n} in ${REF_DIR}/`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="border-b border-border px-3 py-2">
        <p className="text-xs font-medium text-fg">Referenzen</p>
        <p className="text-[11px] text-muted">Der Agent sieht diesen Ordner zuerst. Code bleibt im Workspace.</p>
      </div>
      <div
        className={cn(
          "m-2 rounded-lg border border-dashed px-3 py-6 text-center text-xs",
          over ? "border-accent bg-hover text-fg" : "border-border text-muted",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          const drag = getDrag(e.dataTransfer);
          if (drag?.path && files[drag.path] != null && !drag.path.startsWith(`${REF_DIR}/`)) {
            const dest = copyIntoRef(files, drag.path);
            if ("error" in dest) {
              setNotice(dest.error);
              return;
            }
            writeFile(dest.path, files[drag.path] ?? "");
            setNotice(`${drag.path} → ${dest.path}`);
            return;
          }
          if (hasOsFiles(e.dataTransfer)) void ingest([...e.dataTransfer.files]);
        }}
      >
        <Upload className="mx-auto mb-1 size-4" />
        Ablegen oder{" "}
        <label className="cursor-pointer text-fg underline">
          wählen
          <input
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const list = [...(e.target.files ?? [])];
              e.target.value = "";
              void ingest(list);
            }}
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {rows.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">Leer. Specs, Screenshots, API-Beispiele hierhin.</p>
        ) : (
          rows.map((row) => (
              <div
                key={row.path}
                className="flex items-center gap-1 px-2 py-1 hover:bg-hover"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ x: e.clientX, y: e.clientY, path: row.path });
                }}
              >
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openFile(row.path)}>
                  {row.image ? <ImageIcon className="size-3.5 shrink-0 text-muted" /> : <FileText className="size-3.5 shrink-0 text-muted" />}
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-xs text-fg">{row.path.slice(REF_DIR.length + 1)}</span>
                    <span className="block truncate text-[10px] text-muted">{row.title}</span>
                  </span>
                </button>
                <Button
                  variant="quiet"
                  className="h-7 w-7 p-0"
                  aria-label="Entfernen"
                  onClick={() => {
                    void confirmApp(`„${row.path}“ löschen?`, { danger: true, ok: "Löschen" }).then((ok) => {
                      if (ok) deleteFile(row.path);
                    });
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))
        )}
      </div>
      {menu ? (
        <CtxMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Öffnen", onClick: () => openFile(menu.path) },
            { label: "An Agent", onClick: () => useIde.getState().pushAgent(`Nutze die Referenz ${menu.path}`) },
            {
              label: "Entfernen",
              danger: true,
              onClick: () => {
                void confirmApp(`„${menu.path}“ löschen?`, { danger: true, ok: "Löschen" }).then((ok) => {
                  if (ok) deleteFile(menu.path);
                });
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}

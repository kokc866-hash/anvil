import { selectFileKeys } from "@/lib/workspace-index";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileCode,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  Save,
  Trash2,
  Lock,
  Pin,
  X,
} from "lucide-react";
import { useIde } from "@/store/ide";
import { baseName, buildTree, cleanPath, isPinnedPath, joinPath, parentDir, visibleTree } from "@/lib/fs";
import { Button } from "@/components/ui/button";
import { CtxMenu, type CtxItem } from "@/components/ide/ctx-menu";
import { cn } from "@/lib/cn";
import { diskFolderName, diskSupported, pickFolder, saveFolder } from "@/lib/disk";
import { canOpenOsWorkspace, openOsWorkspace } from "@/lib/workspace-open";
import { zipFiles } from "@/lib/archive";
import { langFromPath, templateFor } from "@/lib/languages";
import { canMove, getDrag, hasOsFiles, importDropped, setDrag, uniqueDest } from "@/lib/dnd";
import { preferredExt } from "@/lib/learn";
import { confirmApp } from "@/lib/confirm";
import { useT } from "@/lib/i18n";
import { isSecretPath } from "@/lib/ref";

const FILE_KINDS: { label: string; ext: string }[] = [
  { label: "Python", ext: "py" },
  { label: "JavaScript", ext: "js" },
  { label: "TypeScript", ext: "ts" },
  { label: "HTML", ext: "html" },
  { label: "CSS", ext: "css" },
  { label: "Markdown", ext: "md" },
  { label: "JSON", ext: "json" },
  { label: "Go", ext: "go" },
  { label: "Rust", ext: "rs" },
  { label: "Java", ext: "java" },
  { label: "C", ext: "c" },
  { label: "C++", ext: "cpp" },
  { label: "C#", ext: "cs" },
  { label: "PHP", ext: "php" },
  { label: "Ruby", ext: "rb" },
  { label: "Text", ext: "txt" },
];

type Menu = { x: number; y: number; path: string; type: "dir" | "file" };

export function FileTree() {
  const t = useT();
  const fileKeys = useIde(selectFileKeys);
  const dirs = useIde((s) => s.dirs);
  const collapsed = useIde((s) => s.collapsed);
  const activePath = useIde((s) => s.activePath);
  const dirty = useIde((s) => s.dirty);
  const flashPath = useIde((s) => s.flashPath);
  const openFile = useIde((s) => s.openFile);
  const writeFile = useIde((s) => s.writeFile);
  const deleteFile = useIde((s) => s.deleteFile);
  const createFolder = useIde((s) => s.createFolder);
  const deleteDir = useIde((s) => s.deleteDir);
  const movePath = useIde((s) => s.movePath);
  const duplicateFile = useIde((s) => s.duplicateFile);
  const renameFile = useIde((s) => s.renameFile);
  const toggleCollapsed = useIde((s) => s.toggleCollapsed);
  const setSidebar = useIde((s) => s.setSidebar);
  const setNotice = useIde((s) => s.setNotice);
  const applyFiles = useIde((s) => s.applyFiles);
  const setDiskName = useIde((s) => s.setDiskName);
  const diskName = useIde((s) => s.diskName);
  const box = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState({ top: 0, h: 480 });
  const [slim, setSlim] = useState(false);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [newName, setNewName] = useState("");
  const [inDir, setInDir] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const expandTimer = useRef<number>(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const [fileExt, setFileExt] = useState("py");

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => setSlim(el.clientWidth < 280);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function cancelCreate() {
    setCreating(null);
    setNewName("");
    setInDir("");
  }

  function applyExt(ext: string) {
    setFileExt(ext);
    const cur = newName.trim();
    const stem = !cur ? "neu" : cur.includes(".") ? cur.slice(0, cur.lastIndexOf(".")) : cur;
    const next = `${stem}.${ext}`;
    setNewName(next);
    requestAnimationFrame(() => {
      const el = nameRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(0, stem.length);
    });
  }

  useEffect(() => {
    if (creating) nameRef.current?.focus();
  }, [creating, inDir]);

  const allPaths = fileKeys.split("\n").filter(Boolean);
  const items = useMemo(
    () => visibleTree(buildTree(allPaths, dirs), collapsed, filter),
    [fileKeys, dirs, collapsed, filter],
  );

  const hasKids = useMemo(() => {
    const s = new Set<string>();
    for (const p of allPaths) {
      let d = parentDir(p);
      while (d) {
        s.add(d);
        d = parentDir(d);
      }
    }
    for (const d of dirs) {
      const p = parentDir(d);
      if (p) s.add(p);
    }
    return s;
  }, [fileKeys, dirs]);

  useEffect(() => {
    if (!flashPath) return;
    const idx = items.findIndex((i) => i.path === flashPath);
    const el = listRef.current;
    if (idx >= 0 && el) {
      const top = idx * 32;
      if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - 32) el.scrollTop = Math.max(0, top - 64);
      return;
    }
    const hit = document.querySelector(`[data-path="${CSS.escape(flashPath)}"]`);
    hit?.scrollIntoView({ block: "nearest" });
  }, [flashPath, items]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const read = () => setWin((w) => (w.h === el.clientHeight ? w : { ...w, h: el.clientHeight }));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fileKeys]);

  function targetDir(): string {
    if (!selected) return "";
    const hit = items.find((i) => i.path === selected);
    if (hit?.type === "dir") return selected;
    return parentDir(selected);
  }

  function beginCreate(kind: "file" | "dir", dir = targetDir()) {
    if (dir && collapsed.includes(dir)) toggleCollapsed(dir);
    setInDir(dir);
    setCreating(kind);
    if (kind === "file") {
      const ext = (preferredExt() || ".py").replace(/^\./, "");
      setFileExt(ext);
      const hint = useIde.getState().chat.filter((m) => m.role === "user").at(-1)?.content ?? "";
      setNewName(`neu.${ext}`);
      void import("@/lib/brain").then((b) =>
        b.brainRename(hint || `datei ${ext}`, ext).then((n) => {
          setNewName((cur) => (cur.startsWith("neu.") ? n : cur));
        }),
      );
    } else {
      setNewName("");
    }
    setMenu(null);
  }

  useEffect(() => {
    function onNew(e: Event) {
      const kind = (e as CustomEvent<"file" | "dir">).detail ?? "file";
      beginCreate(kind);
    }
    function onOpen() {
      void (async () => {
        if (canOpenOsWorkspace()) {
          const r = await openOsWorkspace();
          if (!r.ok) {
            if (r.error && r.error !== "Kein Ordner") setNotice(r.error);
            return;
          }
          if (r.skipped) setNotice(`${r.n} Dateien, ${r.skipped} übersprungen`);
          else setNotice(`${r.n ?? 0} Dateien geladen`);
          return;
        }
        if (!diskSupported()) {
          setNotice("Ordner öffnen braucht Chrome/Edge oder das Anvil-Fenster.");
          return;
        }
        const pack = await pickFolder();
        applyFiles(pack.files, pack.dirs);
        setDiskName(diskFolderName());
        const first = Object.keys(pack.files).sort()[0];
        if (first) openFile(first);
        const n = Object.keys(pack.files).length;
        setNotice(pack.skipped ? `${n} Dateien, ${pack.skipped} übersprungen` : `${n} Dateien geladen`);
      })().catch((err) => setNotice(err instanceof Error ? err.message : "Ordner nicht geöffnet"));
    }
    function onSave() {
      const st = useIde.getState();
      void saveFolder(st.files, st.dirs)
        .then(() => setNotice("Auf Festplatte gespeichert"))
        .catch((err) => setNotice(err instanceof Error ? err.message : "Speichern fehlgeschlagen"));
    }
    window.addEventListener("anvil-new-file", onNew as EventListener);
    window.addEventListener("anvil-open-disk", onOpen);
    window.addEventListener("anvil-save-disk", onSave);
    return () => {
      window.removeEventListener("anvil-new-file", onNew as EventListener);
      window.removeEventListener("anvil-open-disk", onOpen);
      window.removeEventListener("anvil-save-disk", onSave);
    };
  }, [applyFiles, openFile, setDiskName, setNotice]);

  function submitNew() {
    const raw0 = cleanPath(inDir ? joinPath(inDir, newName) : newName);
    let raw = raw0;
    if (creating === "file" && raw && !raw.includes(".")) raw += `.${fileExt}`;
    if (!raw) {
      cancelCreate();
      return;
    }
    if (creating === "dir") {
      createFolder(raw);
      setSelected(raw);
    } else {
      writeFile(raw, useIde.getState().files[raw] ?? templateFor(raw));
      openFile(raw);
      setSelected(raw);
    }
    setNewName("");
    setCreating(null);
    setInDir("");
  }

  async function handleDrop(e: DragEvent, dir: string) {
    if (hasOsFiles(e.dataTransfer) && e.dataTransfer.files.length) {
      const n = await importDropped([...e.dataTransfer.files], dir);
      if (n) setNotice(`${n} nach ${dir || "/"}`);
      return;
    }
    const drag = getDrag(e.dataTransfer);
    if (!drag?.path || drag.path === dir) return;
    if (!canMove(drag.path, dir)) return;
    const dest = uniqueDest(useIde.getState().files, dir, drag.path.split("/").pop() ?? drag.path);
    if (drag.path in useIde.getState().files) {
      if (dest === drag.path) return;
      renameFile(drag.path, dest);
    } else {
      movePath(drag.path, dir);
    }
    setNotice(`${drag.path} → ${dir || dest}`);
  }

  const menuItems: CtxItem[] = menu
    ? menu.type === "file"
      ? [
          { label: "Öffnen", onClick: () => openFile(menu.path) },
          { label: "Umbenennen", onClick: () => { setRenaming(menu.path); setRenameTo(menu.path); } },
          { label: "Duplizieren", onClick: () => duplicateFile(menu.path) },
          { label: "Pfad kopieren", onClick: () => { void navigator.clipboard.writeText(menu.path); setNotice("Pfad kopiert"); } },
          { label: "Nach ref/", onClick: () => {
            void import("@/lib/ref").then((r) => {
              const st = useIde.getState();
              const dest = r.copyIntoRef(st.files, menu.path);
              if ("error" in dest) {
                setNotice(dest.error);
                return;
              }
              const content = st.files[menu.path];
              if (content != null) writeFile(dest.path, content);
              setNotice(`→ ${dest.path}`);
            });
          } },
          { sep: true, label: "" },
          { label: "Agent: erklären", onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(menu.path, "explain")) },
          { label: "Agent: Tests", onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(menu.path, "tests")) },
          { label: "Agent: Review", onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(menu.path, "review")) },
          { label: "Agent: beheben", onClick: () => void import("@/lib/fix-agent").then((m) => m.askFile(menu.path, "fix")) },
          { sep: true, label: "" },
          { label: "Löschen", danger: true, onClick: () => { void confirmApp(`„${menu.path}“ löschen?`, { danger: true, ok: "Löschen" }).then((ok) => { if (ok) deleteFile(menu.path); }); } },
        ]
      : [
          { label: "Neue Datei hier", onClick: () => beginCreate("file", menu.path) },
          { label: "Neuer Ordner hier", onClick: () => beginCreate("dir", menu.path) },
          ...(menu.path
            ? [
                { sep: true, label: "" },
                { label: "Ordner löschen", danger: true, onClick: () => { void confirmApp(`Ordner „${menu.path}“ und Inhalt löschen?`, { danger: true, ok: "Löschen" }).then((ok) => { if (ok) deleteDir(menu.path); }); } },
              ]
            : []),
        ]
    : [];

  return (
    <div ref={box} className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-hidden border-b border-border px-1">
        <span className={cn("min-w-0 flex-1 truncate px-2 text-xs font-medium text-muted", slim && "hidden")}>
          {diskName || t("files")}
        </span>
        {slim ? <span className="min-w-0 flex-1" /> : null}
        <Button variant="quiet" className="h-8 w-8 p-0" title={t("newFile")} onClick={() => beginCreate("file")}>
          <Plus className="size-3.5" />
        </Button>
        <Button variant="quiet" className="h-8 w-8 p-0" title={t("newFolder")} onClick={() => beginCreate("dir")}>
          <FolderPlus className="size-3.5" />
        </Button>
        <Button variant="quiet" className="h-8 w-8 p-0" title="Mehr" onClick={() => setMore((v) => !v)}>
          <MoreHorizontal className="size-4" />
        </Button>
        <Button variant="quiet" className="h-8 w-8 p-0" title={t("closeExplorer")} onClick={() => setSidebar(null)}>
          <X className="size-3.5" />
        </Button>
      </div>
      {more ? (
        <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            onClick={() => window.dispatchEvent(new Event("anvil-open-disk"))}
          >
            <FolderOpen className="size-3.5" /> {canOpenOsWorkspace() ? "Desktop-Ordner" : t("open")}
          </Button>
          <Button variant="quiet" className="h-7 px-2 text-[11px]" onClick={() => window.dispatchEvent(new Event("anvil-save-disk"))}>
            <Save className="size-3.5" /> Speichern
          </Button>
          <Button
            variant="quiet"
            className="h-7 px-2 text-[11px]"
            onClick={() => {
              const files = useIde.getState().files;
              const safe = Object.fromEntries(Object.entries(files).filter(([p]) => !isSecretPath(p)));
              void zipFiles(safe).then((blob) => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = `${(diskName || "anvil").replace(/\s+/g, "-")}.zip`;
                a.click();
                URL.revokeObjectURL(a.href);
              });
            }}
          >
            <Download className="size-3.5" /> ZIP
          </Button>
          <Button variant="quiet" className="h-7 px-2 text-[11px]" onClick={() => window.dispatchEvent(new Event("anvil-starter"))}>
            <LayoutTemplate className="size-3.5" /> Vorlage
          </Button>
        </div>
      ) : null}
      <div className="border-b border-border px-2 py-1.5">
        <input
          value={filter}
          placeholder={t("filter")}
          className="h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg outline-none placeholder:text-subtle"
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {creating ? (
        <form
          className="border-b border-border px-2 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitNew();
          }}
        >
          <p className="mb-1 text-[11px] text-muted">
            {creating === "dir" ? "Neuer Ordner" : "Neue Datei"}
            {inDir ? ` in ${inDir}` : " im Projekt"}
          </p>
          <div className="flex gap-1">
            <input
              ref={nameRef}
              value={newName}
              placeholder={creating === "dir" ? "Name" : "name.py"}
              className="h-8 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 text-sm text-fg outline-none"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelCreate();
                }
              }}
            />
            <Button type="submit" variant="primary" className="h-8 px-2 text-xs">
              Anlegen
            </Button>
            <Button type="button" variant="quiet" className="h-8 px-2 text-xs" onClick={cancelCreate}>
              Abbrechen
            </Button>
          </div>
          {creating === "file" ? (
            <select
              className="mt-1.5 h-8 w-full rounded-md border border-border bg-bg px-2 text-xs text-fg"
              value={fileExt}
              onChange={(e) => applyExt(e.target.value)}
            >
              {FILE_KINDS.map((k) => (
                <option key={k.ext} value={k.ext}>
                  {k.label} (.{k.ext})
                </option>
              ))}
            </select>
          ) : null}
        </form>
      ) : null}
      <div
        ref={listRef}
        tabIndex={0}
        className={cn("min-h-0 flex-1 overflow-auto py-1 outline-none", dragOver === "" ? "bg-hover/40" : "")}
        onScroll={(e) => {
          const el = e.currentTarget;
          setWin((w) => (Math.abs(w.top - el.scrollTop) < 8 && w.h === el.clientHeight ? w : { top: el.scrollTop, h: el.clientHeight }));
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = hasOsFiles(e.dataTransfer) ? "copy" : "move";
          setDragOver("");
        }}
        onDragLeave={() => setDragOver((p) => (p === "" ? null : p))}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(null);
          void handleDrop(e, "");
        }}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY, path: "", type: "dir" });
        }}
        onKeyDown={(e) => {
          if (e.key === "F2" && selected && selected in useIde.getState().files) {
            e.preventDefault();
            setRenaming(selected);
            setRenameTo(selected);
          }
          if (e.key === "Delete" && selected) {
            e.preventDefault();
            const isDir = dirs.includes(selected) || items.find((i) => i.path === selected)?.type === "dir";
            if (isDir) {
              void confirmApp(`Ordner „${selected}“ löschen?`, { danger: true, ok: "Löschen" }).then((ok) => { if (ok) deleteDir(selected); });
            } else {
              void confirmApp(`„${selected}“ löschen?`, { danger: true, ok: "Löschen" }).then((ok) => { if (ok) deleteFile(selected); });
            }
          }
        }}
      >
        {items.length === 0 && !creating ? (
          <div className="px-3 py-4 text-sm text-muted">
            <p>Noch leer.</p>
            <button type="button" className="mt-2 text-fg hover:underline" onClick={() => beginCreate("file")}>
              Datei anlegen
            </button>
            {" · "}
            <button type="button" className="text-fg hover:underline" onClick={() => beginCreate("dir")}>
              Ordner anlegen
            </button>
          </div>
        ) : (
          (() => {
            const ROW = 32;
            const virtual = items.length > 80;
            const overscan = 14;
            const start = virtual ? Math.max(0, Math.floor(win.top / ROW) - overscan) : 0;
            const end = virtual ? Math.min(items.length, Math.ceil((win.top + win.h) / ROW) + overscan) : items.length;
            const slice = items.slice(start, end);
            return (
              <div style={virtual ? { height: items.length * ROW, position: "relative" } : undefined}>
                {slice.map((item, i) => {
            const abs = start + i;
            const name = baseName(item.path);
            const isOpen = !collapsed.includes(item.path);
            const emptyDir = item.type === "dir" && !hasKids.has(item.path);
            const pinned = isPinnedPath(item.path);
            const pinEnd = pinned && !isPinnedPath(items[abs + 1]?.path ?? "");
            return (
              <div
                key={`${item.type}-${item.path}`}
                style={virtual ? { position: "absolute", top: abs * ROW, left: 0, right: 0, height: ROW } : undefined}
              >
                <div
                  data-path={item.path}
                  className={cn(
                    "group flex h-8 items-center gap-1 pr-1 text-sm",
                    selected === item.path || activePath === item.path ? "bg-hover text-fg" : "text-muted hover:bg-hover hover:text-fg",
                    dragOver === item.path ? "ring-1 ring-inset ring-accent/40" : "",
                    flashPath === item.path ? "ui-flash" : "",
                    pinEnd ? "border-b border-border" : "",
                  )}
                  style={{ paddingLeft: 8 + item.depth * (slim ? 8 : 12) }}
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDrag(e.dataTransfer, { kind: "path", path: item.path });
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = hasOsFiles(e.dataTransfer) ? "copy" : "move";
                    setDragOver(item.path);
                    if (item.type === "dir" && collapsed.includes(item.path)) {
                      window.clearTimeout(expandTimer.current);
                      expandTimer.current = window.setTimeout(() => {
                        if (useIde.getState().collapsed.includes(item.path)) toggleCollapsed(item.path);
                      }, 450);
                    }
                  }}
                  onDragLeave={() => {
                    window.clearTimeout(expandTimer.current);
                    setDragOver((p) => (p === item.path ? null : p));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.clearTimeout(expandTimer.current);
                    setDragOver(null);
                    const dir = item.type === "dir" ? item.path : parentDir(item.path);
                    void handleDrop(e, dir);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSelected(item.path);
                    setMenu({ x: e.clientX, y: e.clientY, path: item.path, type: item.type });
                  }}
                >
                  {item.type === "dir" ? (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      onClick={() => {
                        setSelected(item.path);
                        toggleCollapsed(item.path);
                      }}
                    >
                      {isOpen ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
                      {isOpen ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />}
                      <span className="truncate">{name}</span>
                      {pinned && item.depth === 0 ? <Pin className="size-3 shrink-0 text-subtle" aria-hidden /> : null}
                      {emptyDir && !slim ? <span className="text-[10px] text-subtle">leer</span> : null}
                    </button>
                  ) : renaming === item.path ? (
                    <input
                      autoFocus
                      value={renameTo}
                      className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-bg px-1 font-mono text-xs text-fg outline-none"
                      onChange={(e) => setRenameTo(e.target.value)}
                      onBlur={() => setRenaming(null)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          renameFile(item.path, renameTo);
                          setRenaming(null);
                        }
                        if (e.key === "Escape") setRenaming(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      onClick={() => {
                        setSelected(item.path);
                        openFile(item.path);
                      }}
                      onDoubleClick={() => {
                        setRenaming(item.path);
                        setRenameTo(item.path);
                      }}
                    >
                      <span className="w-3.5 shrink-0" />
                      {fileIcon(item.path)}
                      <span className="truncate">{name}</span>
                      {dirty[item.path] ? <span className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
                    </button>
                  )}
                  {item.type === "file" ? (
                    <button
                      type="button"
                      className="invisible size-7 rounded-sm text-subtle hover:text-danger group-hover:visible"
                      aria-label={`${item.path} löschen`}
                      onClick={() => {
                        void confirmApp(`„${item.path}“ löschen?`, { danger: true, ok: "Löschen" }).then((ok) => { if (ok) deleteFile(item.path); });
                      }}
                    >
                      <Trash2 className="mx-auto size-3.5" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="invisible size-7 rounded-sm text-subtle hover:text-fg group-hover:visible"
                      title="Datei in diesem Ordner"
                      onClick={() => beginCreate("file", item.path)}
                    >
                      <Plus className="mx-auto size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
                })}
              </div>
            );
          })()
        )}
      </div>
      <div className="border-t border-border px-2 py-1.5 text-[11px] text-subtle">
        <span className="block truncate">
          {allPaths.length} Dateien
          {dirs.length ? ` · ${dirs.length} Ordner` : ""}
          {selected && !slim ? ` · ${selected}` : ""}
        </span>
      </div>
      {menu ? <CtxMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={menuItems} /> : null}
    </div>
  );
}

function fileIcon(path: string) {
  const lang = langFromPath(path);
  const cls = "size-3.5 shrink-0";
  if (isSecretPath(path)) return <Lock className={cls} />;
  if (lang === "json") return <FileJson className={cls} />;
  if (lang === "markdown" || lang === "html") return <FileText className={cls} />;
  return <FileCode className={cls} />;
}

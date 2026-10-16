export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

// Track length ("3:32"), or a total ("5h 49m") once it passes an hour.
export function formatDuration(sec?: number): string {
  if (sec === undefined) return "--:--";
  if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 60)}:${Math.floor(sec % 60)
    .toString()
    .padStart(2, "0")}`;
}

export function formatDate(iso?: string): string {
  return iso ? new Date(iso).toLocaleDateString() : "";
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

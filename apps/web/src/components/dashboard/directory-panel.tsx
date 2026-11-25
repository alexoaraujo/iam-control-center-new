"use client";
import { useState, type FormEvent } from "react";
import type { DirectoryKind, DirectoryResult } from "../../lib/authorization";

export function DirectoryPanel({ kind }: { kind: DirectoryKind }) {
  const [tenantId, setTenantId] = useState("");
  const [identityId, setIdentityId] = useState("");
  const [result, setResult] = useState<DirectoryResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reset = () => { setResult(null); setMessage(""); };
  async function load(cursor: string | null) {
    setBusy(true); setResult(null); setMessage("Consultando…");
    try {
      const response = await fetch("/api/directory/read", { method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tenantId, identityId, kind, cursor }) });
      if (!response.ok) { setMessage("Acesso negado ou fonte indisponível."); return; }
      const data = await response.json() as DirectoryResult;
      setResult(data); setMessage(data.rows.length === 0 ? "Nenhum registro autorizado nesta página." : "Consulta concluída.");
    } catch { setMessage("Fonte indisponível."); }
    finally { setBusy(false); }
  }
  return <div className="directory-panel">
    <p>Informe o UUID do tenant e o UUID da sua identidade local. Os seletores não concedem permissões.</p>
    <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void load(null); }}>
      <label>Tenant UUID <input required maxLength={36} value={tenantId} disabled={busy} onChange={event => { setTenantId(event.target.value); reset(); }} /></label>
      <label>Identidade local UUID <input required maxLength={36} value={identityId} disabled={busy} onChange={event => { setIdentityId(event.target.value); reset(); }} /></label>
      <button type="submit" disabled={busy}>Consultar</button>
    </form>
    <p role="status">{message}</p>
    {result && <>
      <ul>{result.rows.map(row => <li key={row.id}>{row.displayName ?? "Sem nome"} · {row.id} · {row.status}</li>)}</ul>
      {result.nextCursor && <button type="button" disabled={busy} onClick={() => void load(result.nextCursor)}>Próxima página</button>}
    </>}
  </div>;
}

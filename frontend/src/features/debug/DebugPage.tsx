import { useState } from 'react';
import { api } from '../../api/client';

interface Props { onError: (message: string | null) => void; }
interface LogEntry { time: string; code: string; name: string; topic: string; payload: string; }

export function DebugPage({ onError }: Props) {
  const [topic, setTopic] = useState('/estation/7301A67/recv');
  const [payload, setPayload] = useState('{"Code":4,"Items":[{"TagID":"AD1E000E9EEB","Color":6}],"Token":""}');
  const [sent, setSent] = useState<LogEntry[]>([]);

  const publish = async () => {
    try {
      const parsed = JSON.parse(payload) as { Code?: number; Name?: string };
      await api.publishMqtt(topic, parsed);
      setSent((current) => [{ time: new Date().toLocaleTimeString(), code: String(parsed.Code ?? '—'), name: parsed.Name || '—', topic, payload }, ...current]);
      onError(null);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Payload must be valid JSON and publish must succeed');
    }
  };

  const table = (title: string, entries: LogEntry[], clear: () => void) => (
    <section className="panel log-panel">
      <div className="panel-head"><h3>{title}</h3><div className="actions"><button className="btn-sm btn-ghost" onClick={() => void navigator.clipboard?.writeText(entries.map((entry) => JSON.stringify(entry)).join('\n'))} type="button">Copy</button><button className="btn-sm btn-ghost" onClick={clear} type="button">Clear</button></div></div>
      <div className="table-wrap"><table><thead><tr><th>Time</th><th>Code</th><th>Name</th><th>Topic</th><th>Payload</th></tr></thead><tbody>{entries.length === 0 ? <tr className="empty-row"><td colSpan={5}>No messages published yet</td></tr> : entries.map((entry, index) => <tr key={`${entry.time}-${index}`}><td>{entry.time}</td><td>{entry.code}</td><td>{entry.name}</td><td>{entry.topic}</td><td><code>{entry.payload}</code></td></tr>)}</tbody></table></div>
    </section>
  );

  return <div className="debug-wrap">
    <div className="logs-grid">{table('Publish Message Box', sent, () => setSent([]))}{table('Receive Message Box', [], () => undefined)}</div>
    <section className="panel"><div className="panel-head"><h3>Publish Message</h3></div><div className="panel-body compose">
      <div className="field"><label>Topic</label><input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. AP/7301972/request" /></div>
      <div className="field"><label>Payload</label><textarea value={payload} onChange={(event) => setPayload(event.target.value)} style={{ minHeight: 160 }} /></div>
      <div className="compose-foot"><p className="hint">If payload parses as JSON, its <code className="inline">Code</code> field labels the row below.</p><button className="btn-primary" onClick={() => void publish()} type="button">Publish via Server</button></div>
    </div></section>
  </div>;
}

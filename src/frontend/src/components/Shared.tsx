import type { ReactNode } from 'react';
import type { Delivery } from '../types';

export function badge(status: string) {
  return <span className={'status ' + status.toLowerCase().replace(/ /g, '-')}>{status}</span>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

export function Stat({ label, value, icon, accent = 'blue' }: { label: string; value: number; icon: string; accent?: string }) {
  return <div className="stat-card"><div><small>{label}</small><strong>{value}</strong></div><span className={'stat-icon ' + accent}>{icon}</span></div>;
}

export function DeliveryTable({ records, onOpen }: { records: Delivery[]; onOpen: (delivery: Delivery) => void }) {
  return <div className="table-wrap"><table>
    <thead><tr><th>Delivery ID</th><th>Supplier</th><th>Received on</th><th>Status</th><th>Action</th></tr></thead>
    <tbody>{records.length ? records.map(r => <tr key={r.id}>
      <td><strong>{r.id}</strong></td>
      <td>{r.supplier}<small className="cell-sub">{r.po}</small></td>
      <td>{r.createdAt}</td><td>{badge(r.status)}</td>
      <td><button className="link-btn" onClick={() => onOpen(r)}>View details →</button></td>
    </tr>) : <tr><td colSpan={5} className="empty-cell">No delivery records found.</td></tr>}</tbody>
  </table></div>;
}

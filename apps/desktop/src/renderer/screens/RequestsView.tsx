import React, { useState } from 'react'

type Tab = 'refund' | 'leave' | 'advance' | 'termination'

const REQUESTS = {
  refund: [
    { name: 'Amaka Johnson', detail: 'Transport receipt · $45.00', date: 'Jun 17' },
    { name: 'Tunde Ibrahim', detail: 'Equipment · $320.00', date: 'Jun 15' },
  ],
  leave: [
    { name: 'Emeka Badmus', detail: 'Annual · Jun 24–28 · 5 days', date: 'Jun 16' },
    { name: 'Kofi Osei',    detail: 'Sick · Jun 11–14 · 4 days',  date: 'Jun 10' },
  ],
  advance: [
    { name: 'Sade Olawale', detail: '$675 · 50% of monthly salary', date: 'Jun 18' },
  ],
  termination: [
    { name: 'Kola Adeyemi', detail: 'Effective Jul 1 · Letter uploaded', date: 'Jun 15' },
  ],
}

export function RequestsView() {
  const [tab, setTab] = useState<Tab>('refund')
  const items = REQUESTS[tab]

  return (
    <div>
      <div className="command-bar">
        {(['refund', 'leave', 'advance', 'termination'] as Tab[]).map(t => (
          <button
            key={t}
            className={`btn ${tab === t ? 'primary' : ''}`}
            onClick={() => setTab(t)}
            style={{ textTransform: 'capitalize' }}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="content">
        <div className="panel">
          <div className="panel-head"><h3>{tab.charAt(0).toUpperCase() + tab.slice(1)} requests</h3><a>{items.length} pending</a></div>
          <table className="tbl">
            <thead><tr><th>Employee</th><th>Details</th><th>Submitted</th><th>Actions</th></tr></thead>
            <tbody>
              {items.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.detail}</td>
                  <td>{r.date}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <button className="btn primary" style={{ padding: '3px 10px', fontSize: 10 }}>Approve</button>
                    <button className="btn danger" style={{ padding: '3px 10px', fontSize: 10 }}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

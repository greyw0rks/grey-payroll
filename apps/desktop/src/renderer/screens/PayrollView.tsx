import React from 'react'

export function PayrollView() {
  return (
    <div>
      <div className="command-bar">
        <button className="btn">↑ Export CSV</button>
        <select className="input" style={{ maxWidth: 140, height: 26, fontSize: 11 }}>
          <option>June 2026</option><option>May 2026</option><option>April 2026</option>
        </select>
      </div>
      <div className="content">
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
          <div className="kpi"><div className="kpi-label">Total released (June)</div><div className="kpi-value">$39,900</div></div>
          <div className="kpi"><div className="kpi-label">Transactions</div><div className="kpi-value">180</div><div className="kpi-sub">18 days × 10 avg staff</div></div>
          <div className="kpi"><div className="kpi-label">Pending today</div><div className="kpi-value">$2,840</div><div className="kpi-sub">Releasing 11:30 AM</div></div>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>All payroll releases</h3></div>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Employee</th><th>Amount</th><th>Status</th><th>Tx hash</th></tr></thead>
            <tbody>
              {[
                ['Jun 18','Amaka Johnson','$81.81','Confirmed','0x1a2b…'],
                ['Jun 18','Emeka Badmus','$95.45','Confirmed','0x3c4d…'],
                ['Jun 18','Sade Olawale','$61.36','Confirmed','0x5e6f…'],
                ['Jun 17','Amaka Johnson','$81.81','Confirmed','0x7a8b…'],
                ['Jun 17','Emeka Badmus','$95.45','Confirmed','0x9c0d…'],
              ].map(([date,name,amt,status,tx],i) => (
                <tr key={i}>
                  <td>{date}</td><td>{name}</td>
                  <td style={{ color: 'var(--text-ok)' }}>{amt}</td>
                  <td><span className="pill pill-on">{status}</span></td>
                  <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{tx}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

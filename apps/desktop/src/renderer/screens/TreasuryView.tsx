import React from 'react'

export function TreasuryView() {
  return (
    <div>
      <div className="command-bar">
        <button className="btn primary">+ Deposit USDC</button>
      </div>
      <div className="content">
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          <div className="kpi"><div className="kpi-label">Total balance</div><div className="kpi-value">$48,200</div><div className="kpi-sub">USDC · preview data</div></div>
          <div className="kpi"><div className="kpi-label">Required buffer</div><div className="kpi-value">$37,900</div><div className="kpi-sub">2 months × 12 staff</div></div>
          <div className="kpi"><div className="kpi-label">Available</div><div className="kpi-value">$10,300</div><div className="kpi-sub">Above minimum</div></div>
          <div className="kpi"><div className="kpi-label">Coverage</div><div className="kpi-value">4.8 mo</div><div className="kpi-sub" style={{ color: 'var(--text-ok)' }}>● Healthy</div></div>
        </div>
        <div className="panel">
          <div className="panel-head"><h3>Recent deposits</h3></div>
          <table className="tbl">
            <thead><tr><th>Date</th><th>Amount</th><th>Tx hash</th><th>Block</th></tr></thead>
            <tbody>
              <tr><td>Jun 14</td><td style={{ color: 'var(--text-ok)' }}>+$10,000 USDC</td><td style={{ fontFamily: 'monospace', fontSize: 10 }}>0x1a2b3c…4d5e6f</td><td>#1228410</td></tr>
              <tr><td>May 30</td><td style={{ color: 'var(--text-ok)' }}>+$20,000 USDC</td><td style={{ fontFamily: 'monospace', fontSize: 10 }}>0x9a8b7c…6d5e4f</td><td>#1180290</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

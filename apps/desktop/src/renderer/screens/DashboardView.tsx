import React from 'react'

function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

const STAFF = [
  { initials: 'AJ', name: 'Amaka Johnson', role: 'Eng. Lead', salary: '$1,800', today: 'Checked in', attendance: '14/14', status: 'Active', sc: 'pill-on', tc: '#4ade80' },
  { initials: 'KO', name: 'Kofi Osei',     role: 'Designer',  salary: '$1,200', today: 'On leave',   attendance: '11/14', status: 'Leave',  sc: 'pill-lv', tc: '#fbbf24' },
  { initials: 'FN', name: 'Fatima Nwosu',  role: 'Finance',   salary: '$1,500', today: 'Absent',     attendance: '12/14', status: '⚠ Absent', sc: 'pill-ab', tc: '#f87171' },
  { initials: 'EB', name: 'Emeka Badmus',  role: 'Product',   salary: '$2,100', today: 'Checked in', attendance: '14/14', status: 'Active', sc: 'pill-on', tc: '#4ade80' },
  { initials: 'SO', name: 'Sade Olawale',  role: 'HR Manager',salary: '$1,350', today: 'Checked in', attendance: '13/14', status: 'Active', sc: 'pill-on', tc: '#4ade80' },
  { initials: 'TI', name: 'Tunde Ibrahim', role: 'Sales',     salary: '$1,100', today: 'Checked in', attendance: '14/14', status: 'Active', sc: 'pill-on', tc: '#4ade80' },
]

const PENDING = [
  { dot: '#fbbf24', text: <><b>Refund — Amaka</b><br />Transport · $45.00</>, time: 'Awaiting review' },
  { dot: '#5b9cf6', text: <><b>Leave — Emeka</b><br />Annual · Jun 24–28</>,   time: 'Awaiting review' },
  { dot: '#a78bfa', text: <><b>Advance — Sade</b><br />$675 · 50% monthly</>,  time: 'Awaiting review' },
  { dot: '#f87171', text: <><b>Absent — Fatima</b><br />No reason filed</>,     time: 'Day 2 — warning' },
]

const CHAIN = [
  { dot: '#4ade80', text: <><b>10 salary releases</b> via Celo Sepolia</>,          time: 'Today 08:14 · Block #1240192' },
  { dot: '#5b9cf6', text: <><b>Treasury deposit</b> +$10,000 USDC</>,               time: 'Jun 14 · Block #1228410' },
  { dot: '#4ade80', text: <><b>Refund approved</b> to Tunde $120</>,                time: 'Jun 13 · Block #1223544' },
]

export function DashboardView() {
  return (
    <div>
      <div className="command-bar">
        <button className="btn primary">+ Add employee</button>
        <button className="btn">💰 Fund treasury</button>
        <button className="btn">↑ Export</button>
        <button className="btn">↺ Sync chain</button>
        <div className="cb-search">🔍 Search staff, transactions…</div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="av" style={{ width: 24, height: 24, fontSize: 9 }}>AO</div>
          <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Admin Ojo</span>
        </div>
      </div>
      <div className="content">
        <div className="kpi-row">
          <KPI label="Treasury balance" value="$48,200" sub="+12% from last month" />
          <KPI label="Monthly payroll"  value="$18,950" sub="12 active employees" />
          <KPI label="Released today"   value="$2,840"  sub="10 of 12 checked in" />
          <KPI label="Coverage buffer"  value="4.8 mo"  sub="● Above minimum" />
          <KPI label="Pending actions"  value="10"      sub="5 refund · 3 leave · 2 adv." />
        </div>
        <div className="data-area">
          <div className="panel">
            <div className="panel-head"><h3>Staff roster</h3><a>View all 12</a></div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Employee</th><th>Role</th><th>Monthly salary</th>
                  <th>Today</th><th>Attendance</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {STAFF.map(e => (
                  <tr key={e.name}>
                    <td><span className="av">{e.initials}</span>{e.name}</td>
                    <td>{e.role}</td>
                    <td>{e.salary}</td>
                    <td style={{ color: e.tc }}>{e.today}</td>
                    <td>{e.attendance} days</td>
                    <td><span className={`pill ${e.sc}`}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="right-col">
            <div className="panel">
              <div className="panel-head"><h3>Pending requests</h3><a>See all 10</a></div>
              {PENDING.map((p, i) => (
                <div key={i} className="act-item">
                  <div className="act-dot" style={{ background: p.dot }} />
                  <div>
                    <div className="act-text">{p.text}</div>
                    <div className="act-time">{p.time}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="panel">
              <div className="panel-head"><h3>Chain activity</h3><a>View explorer</a></div>
              {CHAIN.map((c, i) => (
                <div key={i} className="act-item">
                  <div className="act-dot" style={{ background: c.dot }} />
                  <div>
                    <div className="act-text">{c.text}</div>
                    <div className="act-time">{c.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import React from 'react'

export function SettingsView() {
  return (
    <div>
      <div className="content" style={{ maxWidth: 600 }}>
        <div className="panel" style={{ padding: '0 0 4px' }}>
          <div className="panel-head"><h3>Company settings</h3></div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ['Company name', 'Nexus Technologies Ltd'],
              ['Check-in window start', '07:00'],
              ['Check-in window end', '10:00'],
              ['Working days / month', '22'],
              ['Timezone', 'Africa/Lagos'],
              ['Grace period (days)', '1'],
            ].map(([label, val]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ width: 200, fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
                <input className="input" defaultValue={val} style={{ maxWidth: 240 }} />
              </div>
            ))}
            <div style={{ marginTop: 4 }}>
              <button className="btn primary">Save changes</button>
            </div>
          </div>
        </div>

        <div className="panel" style={{ padding: '0 0 4px' }}>
          <div className="panel-head"><h3>Wallet & chain</h3></div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>Connected wallet</div>
            <code style={{ fontSize: 11, color: 'var(--text-info)' }}>0x1a2b3c4d5e6f…</code>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>Network: Arc Testnet (5042002)</div>
          </div>
        </div>
      </div>
    </div>
  )
}

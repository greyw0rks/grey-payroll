import React from 'react'

export function StatusBar() {
  return (
    <div className="status-bar">
      <div className="sb-item"><div className="sb-dot" />Arc Testnet · preview</div>
      <div className="sb-item">Chain ID: 5042002</div>
      <div className="sb-item">Last sync: just now</div>
      <div style={{ marginLeft: 'auto' }} className="sb-item">Grey v1.0.0</div>
    </div>
  )
}

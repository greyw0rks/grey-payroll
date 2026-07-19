import React from 'react'

export function StatusBar() {
  return (
    <div className="status-bar">
      <div className="sb-item"><div className="sb-dot" />Celo Sepolia connected</div>
      <div className="sb-item">Chain ID: 11142220</div>
      <div className="sb-item">Last sync: just now</div>
      <div style={{ marginLeft: 'auto' }} className="sb-item">Grey v1.0.0</div>
    </div>
  )
}

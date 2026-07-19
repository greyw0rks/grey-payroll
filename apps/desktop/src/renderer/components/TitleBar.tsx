import React from 'react'

export function TitleBar() {
  return (
    <div className="title-bar">
      <div className="title-bar-dots">
        <div className="tb-dot" style={{ background: '#ff5f57' }} />
        <div className="tb-dot" style={{ background: '#febc2e' }} />
        <div className="tb-dot" style={{ background: '#28c840' }} />
      </div>
      <span className="tb-logo">Grey</span>
      <span className="tb-title">Employer dashboard</span>
      <div className="tb-controls">
        <div className="tb-btn">—</div>
        <div className="tb-btn">⬜</div>
        <div className="tb-btn close">✕</div>
      </div>
    </div>
  )
}

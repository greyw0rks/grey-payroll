import React, { useState } from 'react'

export function StaffView() {
  const [search, setSearch] = useState('')
  return (
    <div>
      <div className="command-bar">
        <button className="btn primary">+ Add employee</button>
        <div className="cb-search">
          <input
            className="input"
            style={{ background: 'transparent', border: 'none', height: 'auto', padding: 0 }}
            placeholder="Search staff…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="content">
        <div className="panel">
          <div className="panel-head"><h3>All staff</h3><a>12 employees</a></div>
          <table className="tbl">
            <thead><tr><th>Employee</th><th>Role</th><th>Salary</th><th>Start date</th><th>Attendance</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {[
                ['AJ','Amaka Johnson','Engineering Lead','$1,800/mo','Jan 3','14/14','pill-on','Active'],
                ['EB','Emeka Badmus','Product Manager','$2,100/mo','Mar 1','14/14','pill-on','Active'],
                ['KO','Kofi Osei','UI Designer','$1,200/mo','Feb 15','11/14','pill-lv','Leave'],
                ['FN','Fatima Nwosu','Finance Analyst','$1,500/mo','Apr 10','12/14','pill-ab','⚠ Absent'],
                ['SO','Sade Olawale','HR Manager','$1,350/mo','Jan 3','13/14','pill-on','Active'],
                ['TI','Tunde Ibrahim','Sales Lead','$1,100/mo','May 1','14/14','pill-on','Active'],
              ].map(([ini,name,role,sal,start,att,cls,status]) => (
                <tr key={name as string}>
                  <td><span className="av">{ini}</span>{name}</td>
                  <td>{role}</td><td>{sal}</td><td>{start}</td><td>{att} days</td>
                  <td><span className={`pill ${cls}`}>{status}</span></td>
                  <td>
                    <button className="btn" style={{ padding: '3px 10px', fontSize: 10 }}>View</button>
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

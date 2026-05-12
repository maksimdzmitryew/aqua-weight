import React from 'react'

const PageHeader = ({ title, subtitle, onBack, titleBack, onRefresh, onCreate, children }) => {
  return (
    <div className="page-header-container">
      <div className="page-header">
        <h1 className="mb-0">{title}</h1>
        <div className="actions">
          {onBack && (
            <button type="button" onClick={onBack} className="btn btn-secondary">
              ← {titleBack}
            </button>
          )}
          {onRefresh && (
            <button type="button" onClick={onRefresh} className="btn btn-primary">
              Refresh
            </button>
          )}
          {onCreate && (
            <button type="button" onClick={onCreate} className="btn btn-primary">
              + Create
            </button>
          )}
          {children}
        </div>
      </div>
      <div className="page-subtitle" style={{ minHeight: '1.2em' }}>
        {subtitle || <span>&nbsp;</span>}
      </div>
    </div>
  )
}

export default PageHeader

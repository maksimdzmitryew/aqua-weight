import React, { useEffect, useState } from 'react'
import useDocumentTitle, { APP_NAME } from './hooks/useDocumentTitle.js'

export default function App() {
  const [message, setMessage] = useState('Loading...')

  useDocumentTitle()

  useEffect(() => {
    fetch('/api/')
      .then((r) => r.json())
      .then((d) => setMessage(d.message))
      .catch(() => setMessage('Failed to reach backend'))
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <h1>{APP_NAME}</h1>
      <p>Backend says: {message}</p>
      <p>
        Try <code>/api/hello/YourName</code> via this domain:{' '}
        <a href="https://aw.max">https://aw.max</a>
      </p>
      <hr style={{ margin: '24px 0' }} />
      <p>
        Go to your <a href="/dashboard">Dashboard</a>
      </p>
    </div>
  )
}
